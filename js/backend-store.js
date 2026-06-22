/**
 * 初始化后台知识库 IndexedDB store。
 *
 * backend_facts store 由 storage.js 的数据库升级流程创建；当前函数用于保留
 * 后台知识库初始化入口，后续可在这里补充数据校验或迁移逻辑。
 * @returns {Promise<void>}
 */
export async function initBackendStore() {}

/**
 * 预留：写入后台事实。
 * 后台事实应写入独立的 backend_facts store，不与个人 facts store 混用。
 * @returns {Promise<void>}
 */
export async function saveBackendFact() {}

/**
 * 预留：读取后台事实。
 * 后续实现时应只读取 backend_facts store，保持三层知识库隔离。
 * @returns {Promise<object[]>}
 */
export async function getBackendFacts() {
  return [];
}
