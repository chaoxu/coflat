import { parser as baseParser } from "@lezer/markdown";
import { markdownExtensions } from "../../core/parser";

export const markdownSemanticsParser = baseParser.configure(markdownExtensions);
