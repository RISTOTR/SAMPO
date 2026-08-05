import type { SampoApi } from '../shared/app-info'

declare global {
  interface Window {
    sampo: SampoApi
  }
}
