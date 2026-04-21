import { writeProfileFile, deleteFile, validateSlug, validateTtl, type Ttl } from "./io.ts";
import { preprocessQuery, judgeContradiction, extractId } from "./dedup.ts";
import { rawSearch } from "./search.ts";
import type { CommandRunner, InferFn } from "./openclaw-cli.ts";

export interface WriteProfileConfig {
  shallow_threshold: number;
  top_k: number;
}

export interface WriteProfileOpts {
  slug: string;
  ttl: Ttl | string;
  body: string;
  workspace?: string;
  config: WriteProfileConfig;
  runner: CommandRunner;
  inferFn: InferFn;
}

/**
 * Full profile write orchestration:
 * validate → preprocess → search → judge → write → delete (if superseding)
 */
export async function writeProfile(opts: WriteProfileOpts): Promise<string> {
  console.info(`[reflexio] writeProfile: slug=${opts.slug} ttl=${opts.ttl} bodyLen=${opts.body.length} workspace=${opts.workspace ?? "(default)"}`);

  validateSlug(opts.slug);
  validateTtl(opts.ttl);

  const query = await preprocessQuery(opts.body, opts.inferFn);
  console.info(`[reflexio] writeProfile: preprocessed query="${query.slice(0, 120)}"`);

  const neighbors = await rawSearch(query, opts.config.top_k, "profile", opts.runner);
  console.info(`[reflexio] writeProfile: found ${neighbors.length} neighbor(s)${neighbors[0] ? `, top score=${neighbors[0].score.toFixed(3)} path=${neighbors[0].path}` : ""}`);

  const top = neighbors[0];
  let supersedes: string[] | undefined;
  let deleteTarget: string | undefined;

  if (top) {
    const bodyFromSnippet = top.snippet.split("---").slice(2).join("---").trim();
    const decision = await judgeContradiction(opts.body, bodyFromSnippet, opts.inferFn);
    console.info(`[reflexio] writeProfile: contradiction decision="${decision}"`);

    if (decision === "supersede") {
      const oldId = extractId(top.snippet);
      if (oldId) {
        supersedes = [oldId];
        deleteTarget = top.path;
        console.info(`[reflexio] writeProfile: will supersede id=${oldId} path=${top.path}`);
      } else {
        console.error(`[reflexio] writeProfile: decision=supersede but could not extract id from snippet`);
      }
    }
  }

  const newPath = writeProfileFile({
    slug: opts.slug,
    ttl: opts.ttl as Ttl,
    body: opts.body,
    supersedes,
    workspace: opts.workspace,
  });
  console.info(`[reflexio] writeProfile: wrote ${newPath}${supersedes ? ` (supersedes: ${supersedes.join(", ")})` : ""}`);

  if (deleteTarget) {
    const ws = opts.workspace || process.env.WORKSPACE || process.cwd();
    const absDelete = deleteTarget.startsWith("/")
      ? deleteTarget
      : `${ws}/${deleteTarget}`;
    deleteFile(absDelete);
    console.info(`[reflexio] writeProfile: deleted superseded file ${absDelete}`);
  }

  return newPath;
}
