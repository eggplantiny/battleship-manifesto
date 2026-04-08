import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, defaultResolve) {
  try {
    return await defaultResolve(specifier, context, defaultResolve);
  } catch (error) {
    if (!shouldRetryWithTs(specifier)) {
      throw error;
    }

    const tsUrl = toTsUrl(specifier, context.parentURL);
    await access(fileURLToPath(tsUrl), fsConstants.R_OK);
    return defaultResolve(tsUrl.href, context, defaultResolve);
  }
}

function shouldRetryWithTs(specifier) {
  return specifier.startsWith(".") && specifier.endsWith(".js");
}

function toTsUrl(specifier, parentUrl) {
  const tsSpecifier = specifier.slice(0, -3) + ".ts";
  return new URL(tsSpecifier, parentUrl ?? pathToFileURL(process.cwd() + "/").href);
}
