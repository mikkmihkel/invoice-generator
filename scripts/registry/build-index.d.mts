export interface BuildOptions {
  input?: string
  url?: string
  outDir: string
  minCount?: number
  maxPostings?: number
  shardMax?: number
  starMax?: number
  recordShardDigits?: number
  log?: (msg: string) => void
}
export interface BuiltMeta {
  version: number
  builtAt: string
  dataDate: string | null
  count: number
  source: string
  sourceUrl: string
  licence: string
  licenceUrl: string
  attribution: string
  recordShardDigits: number
  stats: Record<string, number>
  shards: Record<string, 0 | 1>
}
export const DEFAULT_SOURCE_URL: string
export const ATTRIBUTION: string
export const LICENCE: string
export function build(options: BuildOptions): Promise<BuiltMeta>
export function buildIndex(records: unknown[], options?: Partial<BuildOptions>): { files: Map<string, string>; meta: BuiltMeta }
export function findZipEntry(zipPath: string, match?: (name: string) => boolean): Promise<{ name: string; method: number; compressedSize: number; uncompressedSize: number; dataStart: number }>
export function openCsvStream(file: string): Promise<NodeJS.ReadableStream>
export function readRecords(stream: NodeJS.ReadableStream, log?: (msg: string) => void): Promise<Array<Record<string, string>>>
