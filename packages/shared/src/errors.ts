/** 统一错误基类，带机器可读的 code —— MCP / HTTP 层直接透传 code */
export class MyceliaError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'MyceliaError'
    this.code = code
    this.details = details
  }
}

export class NotFoundError extends MyceliaError {
  constructor(what: string, id: string) {
    super('not_found', `${what} 不存在：${id}`)
    this.name = 'NotFoundError'
  }
}

export class LockedError extends MyceliaError {
  constructor(id: string) {
    super('locked', `记忆 ${id} 已加密，需先解锁保险箱`)
    this.name = 'LockedError'
  }
}

export class ConfigError extends MyceliaError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, details)
    this.name = 'ConfigError'
  }
}

export class ProviderError extends MyceliaError {
  constructor(provider: string, message: string, details?: unknown) {
    super('provider_error', `[${provider}] ${message}`, details)
    this.name = 'ProviderError'
  }
}
