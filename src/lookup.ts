/** 文档中的名称只能访问目录自身的条目，不能命中 Object.prototype。 */
export function own<T>(record: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}
