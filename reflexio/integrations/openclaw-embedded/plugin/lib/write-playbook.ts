import { writePlaybookFile, deleteFile, validateSlug } from "./io.ts";
import { preprocessQuery, judgeContradiction, extractId } from "./dedup.ts";
import { rawSearch } from "./search.ts";
import type { CommandRunner, InferFn } from "./openclaw-cli.ts";

export interface WritePlaybookConfig {
  shallow_threshold: number;
  top_k: number;
}

export interface WritePlaybookOpts {
  slug: string;
  body: string;
  workspace?: string;
  config: WritePlaybookConfig;
  runner: CommandRunner;
  inferFn: InferFn;
}

/**
 * Full playbook write orchestration:
 * validate → preprocess → search → judge → write → delete (if superseding)
 */
export async function writePlaybook(opts: WritePlaybookOpts): Promise<string> {
  console.info(`[reflexio] writePlaybook: slug=${opts.slug} bodyLen=${opts.body.length} workspace=${opts.workspace ?? "(default)"}`);

  validateSlug(opts.slug);

  const query = await preprocessQuery(opts.body, opts.inferFn);
  console.info(`[reflexio] writePlaybook: preprocessed query="${query.slice(0, 120)}"`);

  const neighbors = await rawSearch(query, opts.config.top_k, "playbook", opts.runner);
  console.info(`[reflexio] writePlaybook: found ${neighbors.length} neighbor(s)${neighbors[0] ? `, top score=${neighbors[0].score.toFixed(3)} path=${neighbors[0].path}` : ""}`);

  const top = neighbors[0];
  let supersedes: string[] | undefined;
  let deleteTarget: string | undefined;

  if (top) {
    const bodyFromSnippet = top.snippet.split("---").slice(2).join("---").trim();
    const decision = await judgeContradiction(opts.body, bodyFromSnippet, opts.inferFn);
    console.info(`[reflexio] writePlaybook: contradiction decision="${decision}"`);

    if (decision === "supersede") {
      const oldId = extractId(top.snippet);
      if (oldId) {
        supersedes = [oldId];
        deleteTarget = top.path;
        console.info(`[reflexio] writePlaybook: will supersede id=${oldId} path=${top.path}`);
      } else {
        console.error(`[reflexio] writePlaybook: decision=supersede but could not extract id from snippet`);
      }
    }
  }

  const newPath = writePlaybookFile({
    slug: opts.slug,
    body: opts.body,
    supersedes,
    workspace: opts.workspace,
  });
  console.info(`[reflexio] writePlaybook: wrote ${newPath}${supersedes ? ` (supersedes: ${supersedes.join(", ")})` : ""}`);

  if (deleteTarget) {
    const ws = opts.workspace || process.env.WORKSPACE || process.cwd();
    const absDelete = deleteTarget.startsWith("/")
      ? deleteTarget
      : `${ws}/${deleteTarget}`;
    deleteFile(absDelete);
    console.info(`[reflexio] writePlaybook: deleted superseded file ${absDelete}`);
  }

  return newPath;
}
