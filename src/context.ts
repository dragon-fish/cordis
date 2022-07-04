import { defineProperty, Dict } from 'cosmokit'
import { Lifecycle } from './lifecycle'
import { isConstructor, Runtime, State } from './state'
import { Registry } from './registry'

export interface Context extends Context.Services, Context.Meta {}

declare global {
  interface Object {
    [Context.current]?: Context
    [Context.source]?: Context
    [Context.filter]?(context: Context): boolean
  }
}

export class Context<T extends Context.Config = Context.Config> {
  static readonly static = Symbol('static')
  static readonly filter = Symbol('filter')
  static readonly source = Symbol('source')
  static readonly current = Symbol('current')
  static readonly internal = Symbol('internal')
  static readonly immediate = Symbol('immediate')

  public options: T

  constructor(config?: T) {
    const attach = (internal: {}) => {
      if (!internal) return
      attach(Object.getPrototypeOf(internal))
      for (const key of Object.getOwnPropertySymbols(internal)) {
        this[key] = new internal[key](this, this.options)
      }
    }

    this.root = this
    this.mapping = Object.create(null)
    this.options = Registry.validate(Context, config)
    attach(this[Context.internal])
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Context <${this.runtime.name}>`
  }

  extend(meta: Partial<Context.Meta> = {}): this {
    return Object.assign(Object.create(this), meta)
  }

  isolate(names: string[]) {
    const mapping = Object.create(this.mapping)
    for (const name of names) {
      mapping[name] = Symbol(name)
    }
    return this.extend({ mapping })
  }
}

export namespace Context {
  export interface Config extends Lifecycle.Config, Registry.Config {}

  /** @deprecated for backward compatibility */
  export interface Services {
    lifecycle: Lifecycle
    registry: Registry
  }

  export const Services: string[] = []

  export interface MixinOptions {
    methods?: string[]
    properties?: string[]
  }

  export function mixin(name: keyof any, options: MixinOptions) {
    for (const key of options.methods || []) {
      defineProperty(Context.prototype, key, function (this: Context, ...args: any[]) {
        return this[name][key](...args)
      })
    }

    for (const key of options.properties || []) {
      Object.defineProperty(Context.prototype, key, {
        get(this: Context) {
          return this[name][key]
        },
        set(this: Context, value: any) {
          this[name][key] = value
        },
      })
    }
  }

  export interface ServiceOptions extends MixinOptions {
    prototype?: any
  }

  export interface Meta {
    root: Context
    state: State
    runtime: Runtime
    mapping: Dict<symbol>
  }

  export function service(name: keyof any, options: ServiceOptions = {}) {
    if (Object.prototype.hasOwnProperty.call(this.prototype, name)) return
    const privateKey = typeof name === 'symbol' ? name : Symbol(name)
    if (typeof name === 'string') Services.push(name)

    Object.defineProperty(this.prototype, name, {
      get(this: Context) {
        const key = this.mapping[name as any] || privateKey
        const value = this.root[key]
        if (!value) return
        defineProperty(value, Context.current, this)
        return value
      },
      set(this: Context, value) {
        const key = this.mapping[name as any] || privateKey
        const oldValue = this.root[key]
        if (oldValue === value) return
        this.root[key] = value
        if (value && typeof value === 'object') {
          defineProperty(value, Context.source, this)
        }
        if (typeof name !== 'string') return

        // trigger event
        const self: object = Object.create(null)
        self[Context.filter] = (ctx) => {
          return this.mapping[name] === ctx.mapping[name]
        }
        this.emit(self, 'internal/service', name)
      },
    })

    if (isConstructor(options)) {
      const internal = ensureInternal(this.prototype)
      internal[privateKey] = options
    }

    mixin(name, options)
  }

  function ensureInternal(prototype: {}) {
    if (Object.prototype.hasOwnProperty.call(prototype, Context.internal)) {
      return prototype[Context.internal]
    }
    const parent = ensureInternal(Object.getPrototypeOf(prototype))
    return prototype[Context.internal] = Object.create(parent)
  }
}

Context.prototype[Context.internal] = Object.create(null)

Context.service('registry', Registry)
Context.service('lifecycle', Lifecycle)

Context.mixin('state', {
  properties: ['runtime'],
})
