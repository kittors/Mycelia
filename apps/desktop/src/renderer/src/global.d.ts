import type { MyceliaApi } from '../../shared/ipc-contract.js'

declare global {
  interface Window {
    mycelia: MyceliaApi
  }
}
