import type { RequestHandler } from "express";
import { AppError } from "../utils/errors.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} does not exist`));
};
