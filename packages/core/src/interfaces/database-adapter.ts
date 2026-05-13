/**
 * 数据库适配器抽象接口
 *
 * 定义平台无关的 SQLite 数据库访问契约。
 * 接口设计贴合 better-sqlite3 API（因为现有查询代码基于此编写），
 * sql.js 等其他实现只需编写薄适配层。
 */

/**
 * 预编译语句接口
 */
export interface PreparedStatement {
  /**
   * 语句是否为只读（SELECT / WITH ... SELECT）
   * better-sqlite3 原生支持此属性，用于安全检查。
   */
  readonly?: boolean

  /**
   * 执行查询并返回第一行结果
   */
  get(...params: unknown[]): Record<string, unknown> | undefined

  /**
   * 执行查询并返回所有行
   */
  all(...params: unknown[]): Record<string, unknown>[]

  /**
   * 执行写操作（INSERT / UPDATE / DELETE）
   */
  run(...params: unknown[]): RunResult
}

/**
 * 写操作的返回结果
 */
export interface RunResult {
  changes: number
  lastInsertRowid?: number | bigint
}

/**
 * 数据库适配器接口
 *
 * 调用方通过此接口操作 SQLite 数据库，不关心底层使用
 * better-sqlite3（Node.js）还是 sql.js（浏览器 WASM）。
 */
export interface DatabaseAdapter {
  /**
   * 执行原始 SQL（不返回结果，用于 DDL 或批量语句）
   */
  exec(sql: string): void

  /**
   * 预编译 SQL 语句
   */
  prepare(sql: string): PreparedStatement

  /**
   * 在事务中执行操作
   */
  transaction<T>(fn: () => T): T

  /**
   * 执行 PRAGMA 命令
   */
  pragma(pragma: string): unknown

  /**
   * 关闭数据库连接
   */
  close(): void

  /**
   * 数据库是否处于只读模式
   */
  readonly?: boolean
}
