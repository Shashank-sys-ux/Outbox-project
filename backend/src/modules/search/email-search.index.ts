import { errors, type Client, type estypes } from "@elastic/elasticsearch";
import type { Logger } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { EmailStatus } from "../../generated/prisma/enums.js";
import { snippetOf } from "../emails/emails.service.js";

export interface EmailDocument {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  attempts: number;
  scheduledAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  completedAt: string | null;
  previewUrl: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface SearchParams {
  userId: string;
  query: string;
  statuses: EmailStatus[];
  page: number;
  pageSize: number;
}

export interface SearchHit extends Omit<EmailDocument, "body" | "userId"> {
  snippet: string;
  highlights: { subject?: string[]; body?: string[]; recipientEmail?: string[] };
  score: number | null;
}

const text = (extra: Omit<estypes.MappingTextProperty, "type"> = {}): estypes.MappingTextProperty => ({
  type: "text",
  ...extra,
});

export const EMAIL_INDEX_BODY: { settings: estypes.IndicesIndexSettings; mappings: estypes.MappingTypeMapping } = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      tokenizer: {
        email_parts: { type: "pattern", pattern: "[^A-Za-z0-9]+" },
      },
      analyzer: {
        email_analyzer: { type: "custom", tokenizer: "email_parts", filter: ["lowercase"] },
      },
    },
  },
  mappings: {
    dynamic: "strict",
    properties: {
      id: { type: "keyword" },
      userId: { type: "keyword" },
      campaignId: { type: "keyword" },
      senderId: { type: "keyword" },
      senderEmail: text({ analyzer: "email_analyzer", fields: { keyword: { type: "keyword" } } }),
      senderName: text(),
      recipientEmail: text({ analyzer: "email_analyzer", fields: { keyword: { type: "keyword" } } }),
      subject: text({ fields: { keyword: { type: "keyword", ignore_above: 512 } } }),
      body: text(),
      status: { type: "keyword" },
      attempts: { type: "integer" },
      scheduledAt: { type: "date" },
      nextAttemptAt: { type: "date" },
      sentAt: { type: "date" },
      completedAt: { type: "date" },
      previewUrl: { type: "keyword", index: false },
      lastError: text(),
      createdAt: { type: "date" },
    },
  },
};

export class SearchUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Search is temporarily unavailable", { cause });
    this.name = "SearchUnavailableError";
  }
}

function isConnectivityError(error: unknown): boolean {
  return (
    error instanceof errors.ConnectionError ||
    error instanceof errors.TimeoutError ||
    error instanceof errors.NoLivingConnectionsError ||
    (error instanceof errors.ResponseError && (error.statusCode ?? 0) >= 500)
  );
}

export class EmailSearchIndex {
  private ready: Promise<void> | undefined;

  constructor(
    private readonly client: Client,
    readonly indexName: string,
    private readonly db: PrismaClient,
    private readonly logger: Logger,
  ) {}

  ensureIndex(): Promise<void> {
    this.ready ??= (async () => {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists) {
        try {
          await this.client.indices.create({ index: this.indexName, ...EMAIL_INDEX_BODY });
          this.logger.info({ index: this.indexName }, "Elasticsearch index created");
        } catch (error) {
          if (!(error instanceof errors.ResponseError && error.body?.error?.type === "resource_already_exists_exception")) {
            throw error;
          }
        }
      }
    })().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async buildDocument(emailId: string): Promise<{ document: EmailDocument; version: number } | null> {
    const email = await this.db.email.findUnique({
      where: { id: emailId },
      include: {
        campaign: { select: { subject: true, body: true } },
        sender: { select: { email: true, displayName: true } },
      },
    });
    if (!email) {
      return null;
    }
    return {
      version: email.updatedAt.getTime(),
      document: {
        id: email.id,
        userId: email.userId,
        campaignId: email.campaignId,
        senderId: email.senderId,
        senderEmail: email.sender.email,
        senderName: email.sender.displayName,
        recipientEmail: email.recipientEmail,
        subject: email.campaign.subject,
        body: email.campaign.body,
        status: email.status,
        attempts: email.attempts,
        scheduledAt: email.scheduledAt.toISOString(),
        nextAttemptAt: email.nextAttemptAt.toISOString(),
        sentAt: email.status === "sent" ? (email.completedAt?.toISOString() ?? null) : null,
        completedAt: email.completedAt?.toISOString() ?? null,
        previewUrl: email.previewUrl,
        lastError: email.lastError,
        createdAt: email.createdAt.toISOString(),
      },
    };
  }

  async indexEmail(emailId: string): Promise<"indexed" | "stale" | "missing"> {
    await this.ensureIndex();
    const built = await this.buildDocument(emailId);
    if (!built) {
      return "missing";
    }
    try {
      await this.client.index({
        index: this.indexName,
        id: built.document.id,
        version: built.version,
        version_type: "external",
        document: built.document,
      });
      return "indexed";
    } catch (error) {
      if (error instanceof errors.ResponseError && error.statusCode === 409) {
        return "stale";
      }
      throw error;
    }
  }

  async bulkIndex(emailIds: string[]): Promise<{ indexed: number; skipped: number }> {
    await this.ensureIndex();
    const operations: object[] = [];
    let skipped = 0;
    for (const emailId of emailIds) {
      const built = await this.buildDocument(emailId);
      if (!built) {
        skipped += 1;
        continue;
      }
      operations.push(
        { index: { _index: this.indexName, _id: built.document.id, version: built.version, version_type: "external" } },
        built.document,
      );
    }
    if (operations.length === 0) {
      return { indexed: 0, skipped };
    }
    const response = await this.client.bulk({ operations, refresh: false });
    const conflicts = response.items.filter((item) => item.index?.status === 409).length;
    const failures = response.items.filter((item) => item.index?.error && item.index.status !== 409);
    if (failures.length > 0) {
      throw new Error(`Bulk indexing failed for ${failures.length} documents`);
    }
    return { indexed: operations.length / 2 - conflicts, skipped: skipped + conflicts };
  }

  async search(params: SearchParams): Promise<{ items: SearchHit[]; total: number; tookMs: number }> {
    const query = params.query.trim();
    try {
      await this.ensureIndex();
      const response = await this.client.search<EmailDocument>({
        index: this.indexName,
        from: (params.page - 1) * params.pageSize,
        size: params.pageSize,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              { term: { userId: params.userId } },
              ...(params.statuses.length > 0 ? [{ terms: { status: params.statuses } }] : []),
            ],
            must:
              query.length > 0
                ? [
                    {
                      multi_match: {
                        query,
                        type: "bool_prefix",
                        operator: "and",
                        fields: ["recipientEmail^3", "subject^2", "body", "senderEmail", "senderName"],
                      },
                    },
                  ]
                : [{ match_all: {} }],
          },
        },
        sort: query.length > 0 ? ["_score", { nextAttemptAt: "desc" }] : [{ nextAttemptAt: "desc" }],
        highlight: {
          pre_tags: ["<mark>"],
          post_tags: ["</mark>"],
          fields: { subject: {}, body: { fragment_size: 120, number_of_fragments: 1 }, recipientEmail: {} },
        },
      });

      const total =
        typeof response.hits.total === "number" ? response.hits.total : (response.hits.total?.value ?? 0);
      const items = response.hits.hits.flatMap((hit) => {
        if (!hit._source) {
          return [];
        }
        const { body, userId: _userId, ...rest } = hit._source;
        return [
          {
            ...rest,
            snippet: snippetOf(body),
            highlights: (hit.highlight ?? {}) as SearchHit["highlights"],
            score: hit._score ?? null,
          },
        ];
      });
      return { items, total, tookMs: response.took };
    } catch (error) {
      if (isConnectivityError(error)) {
        throw new SearchUnavailableError(error);
      }
      throw error;
    }
  }
}
