export { discoverComponents } from "./components.js";
export { diffFile } from "./diff.js";
export { GitAdapter } from "./git.js";
export { listOpenSpecFiles, loadKnowledgeNodes, proposeNode } from "./knowledge.js";
export {
  buildKnowledgePrompt,
  parseAiDrafts,
  requestAiDrafts,
} from "./knowledge-ai.js";
export {
  applyKnowledgeBootstrap,
  defaultKnowledgeTemplate,
  planKnowledgeBootstrap,
} from "./knowledge-bootstrap.js";
export { addKnowledgeComment, knowledgeComments } from "./knowledge-comments.js";
export { knowledgeCoverage } from "./knowledge-coverage.js";
export {
  acceptKnowledgeNode,
  buildTreeIndex,
  knowledgeContext,
  queryKnowledge,
  requireNode,
  saveKnowledgeNode,
} from "./knowledge-index.js";
export { migrateKnowledge, planKnowledgeMigration } from "./knowledge-migrate.js";
export {
  applyKnowledgeTemplate,
  getKnowledgeTemplatePreset,
  knowledgeTemplatePresets,
} from "./knowledge-templates.js";
export {
  codeAreas,
  componentForCodePath,
  guidanceFor,
  loadKnowledgeTree,
} from "./knowledge-tree.js";
export {
  aiKeysFromEnv,
  aiSettingsView,
  discoverLocalAi,
  isLocalEndpoint,
  saveAiSettings,
} from "./local-ai.js";
export { startMcpServer } from "./mcp.js";
export { readText, realRoot, resolveWithinRoot, writeAtomic } from "./paths.js";
export { runProcess } from "./process.js";
export { createSession, RepoSession } from "./session.js";
export { scanSurfaces } from "./surfaces.js";
export { TrailAdapter } from "./trail.js";
export { type RepoWatcher, watchRepo } from "./watch.js";
