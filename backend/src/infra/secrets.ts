import { env } from "../config/env.js";
import { SecretBox } from "../utils/crypto.js";

export const secretBox = new SecretBox(env.ENCRYPTION_KEY);
