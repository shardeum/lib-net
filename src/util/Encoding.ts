export const jsonStringify = <T>(data: T, customStringify?: (data: T) => string): string => {
  return customStringify ? customStringify(data) : JSON.stringify(data)
}

export const jsonParse = <T>(data: string, customParser?: (data: string) => T): T => {
  return customParser ? customParser(data) : JSON.parse(data)
}
