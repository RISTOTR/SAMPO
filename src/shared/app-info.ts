export type AppInfo = {
  name: string
  version: string
  platform: string
  arch: string
}

export type SampoApi = {
  getAppInfo: () => Promise<AppInfo>
}
