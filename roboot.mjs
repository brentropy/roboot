// @ts-check

/**
 * Roboot
 * Copyright (c) 2022 Brent Burgoyne
 * License (MIT): https://github.com/brentropy/roboot/blob/master/LICENSE.md
 * Documentation: https://github.com/brentropy/roboot/blob/master/README.md
 */

/**
 * @typedef {typeof BaseProvider} ProviderClass
 */

/**
 * @typedef {T extends { provide: () => infer R } ? R : never} ProvidedBy
 * @template T
 */

/**
 * Container for resolving dependency instances.
 */
export class Container {
  /** @private */
  finalized = false;

  /**
   * @private
   * @type {Map<ProviderClass, ProviderClass>}
   */
  bindings = new Map();

  /**
   * @private
   * @type {Map<ProviderClass, any>}
   */
  instances = new Map();

  /**
   * @private
   * @type {Map<any, BaseProvider>}
   */
  instanceProviders = new Map();

  /**
   * @private
   * @type {Array<ProviderClass>}
   */
  useStack = [];

  /**
   * @private
   * @type {Array<{
   *   temp: Object;
   *   Dependent: ProviderClass;
   *   Dependency: ProviderClass;
   * }>}
   */
  unresolvedCircular = [];

  /**
   * @type {Map<ProviderClass, Promise<void>> | undefined}
   */
  bootedPromises = undefined;

  /**
   * @type {Map<ProviderClass, Promise<void>> | undefined}
   */
  disposedPromises = undefined;

  /**
   * Use an alternate implementation whenever a provider is used in this
   * container instance.
   *
   * @template T, U
   * @param {ProviderClass} Provider
   * @param {ProviderClass} Implementation
   */
  bind(Provider, Implementation) {
    if (this.instances.has(Provider)) {
      throw new Error(
        "Cannot change binding for a provider that has been already used"
      );
    }
    this.bindings.set(Provider, Implementation);
    return this;
  }

  /**
   * Return an existing instance for a provider or create a new instance if one
   * doesn't already exist.
   *
   * @template {ProviderClass} P
   * @param {P} Dependency
   * @param {ProviderClass} [Dependent] used when tracking circular dependencies
   * @return {ProvidedBy<InstanceType<P>>}
   */
  use(Dependency, Dependent) {
    let instance = this.instances.get(Dependency);
    if (instance === undefined) {
      if (this.useStack.includes(Dependency) && Dependent) {
        instance = {};
        this.unresolvedCircular.push({ temp: instance, Dependent, Dependency });
      } else {
        if (Dependent) {
          this.useStack.push(Dependent);
        }
        instance = this.make(Dependency);
        if (Dependent) {
          this.useStack.pop();
        }
        this.instances.set(Dependency, instance);
      }
    }
    return instance;
  }

  /**
   * Create a new instance of a provider class.
   *
   * @private
   * @template {ProviderClass} P
   * @param {P} Dependency
   * @return {ProvidedBy<InstanceType<P>>}
   */
  make(Dependency) {
    /** @type {ProviderClass} */
    let Implementation = this.bindings.get(Dependency) ?? Dependency;
    let implementation = new Implementation(this);
    /** @type {ProvidedBy<InstanceType<P>>} */
    let instance = implementation.provide();
    this.instanceProviders.set(instance, implementation);
    return instance;
  }

  /**
   * Apply calls a function with the container instance and returns the
   * container instance. This can be useful when with chaining method calls
   * when creating a new container.
   *
   * @param {(container: Container) => any} func
   */
  apply(func) {
    func(this);
    return this;
  }

  /**
   * Boot resolves a single root provider and it's dependencies then boot all
   * provided instances.
   *
   * @template {ProviderClass} P
   * @param {P} Root
   * @return {Promise<ProvidedBy<InstanceType<P>>>}
   */
  async boot(Root) {
    if (this.finalized) {
      throw Error("Container instance cannot be booted more than once");
    }
    this.finalized = true;
    let instance = this.use(Root);
    this.resolveCircular();
    await this.bootAll();
    return instance;
  }

  /**
   * Replace temporary objects returned due to a circular dependency with actual
   * dependency instances.
   *
   * @private
   */
  async resolveCircular() {
    for (let { temp, Dependent, Dependency } of this.unresolvedCircular) {
      let dependant = this.instances.get(Dependent);
      let dependency = this.instances.get(Dependency);
      for (let property in dependant) {
        if (dependant[property] === temp) {
          dependant[property] = dependency;
          break;
        }
      }
    }
    this.unresolvedCircular = [];
  }

  /**
   * Start the async boot for all resolved services and resolve once all have
   * resolved successfully or reject if any once of them fails.
   *
   * @private
   * @return {Promise<void>}
   */
  async bootAll() {
    this.bootedPromises = new Map(
      [...this.instances.entries()].map(([Class, instance]) => [
        Class,
        Promise.resolve().then(() =>
          this.instanceProviders.get(instance)?.boot(instance)
        ),
      ])
    );
    await Promise.all(this.bootedPromises.values());
  }

  /**
   * Start the async boot for all resolved services and resolve once all have
   * resolved successfully or reject if any once of them fails.
   *
   * @return {Promise<void>}
   */
  async dispose() {
    this.disposedPromises = new Map(
      [...this.instances.entries()].map(([Class, instance]) => [
        Class,
        Promise.resolve().then(() =>
          this.instanceProviders.get(instance)?.dispose(instance)
        ),
      ])
    );
    await Promise.all(this.disposedPromises.values());
  }
}

/**
 * Base class used to create provider classes with injectable dependencies.
 *
 * @abstract
 */
class BaseProvider {
  /**
   * @param {Container} container
   */
  constructor(container) {
    /** @private */
    this.container = container;
  }

  /**
   * Use resolve a dependency from the container with dependant tracking to
   * identify and correctly handle circular references.
   *
   * @protected
   * @template {ProviderClass} P
   * @param {P} Dependency
   * @return {ProvidedBy<InstanceType<P>>}
   */
  use(Dependency) {
    return this.container.use(
      Dependency,
      /** @type {ProviderClass} **/ (this.constructor)
    );
  }

  /**
   * Boot is called on all services after all dependencies are resolved.
   *
   * @param {ProvidedBy<this>} instance
   * @return {Promise<void>}
   */
  async boot(instance) {}

  /**
   * Booted returns a promise that will be resolved after the dependency has
   * finished booting.
   *
   * @protected
   * @param {ProviderClass} Dependency
   * @return {Promise<void>}
   */
  booted(Dependency) {
    if (!this.container.bootedPromises) {
      return Promise.reject(
        new Error("Cannot call booted() outside of boot()")
      );
    }
    return (
      this.container.bootedPromises.get(Dependency) ??
      Promise.reject(
        new Error(`Cannot wait for unused ${Dependency.name} to boot`)
      )
    );
  }

  /**
   * Dispose is called on all services when dispose is called on the container.
   *
   * @param {ProvidedBy<this>} instance
   * @return {Promise<void>}
   */
  async dispose(instance) {}

  /**
   * Disposed returns a promise that will be resolved after the dependency has
   * finished disposing.
   *
   * @protected
   * @param {ProviderClass} Dependency
   * @return {Promise<void>}
   */
  disposed(Dependency) {
    if (!this.container.disposedPromises) {
      return Promise.reject(
        new Error("Cannot call disposed() outside of dispose()")
      );
    }
    return (
      this.container.disposedPromises.get(Dependency) ??
      Promise.reject(
        new Error(`Cannot wait for unused ${Dependency.name} to dispose`)
      )
    );
  }

  /**
   * Create a new not implemented error instance that can be thrown in methods
   * of abstract providers that must be implemented by a child class.
   *
   * @protected
   * @throws
   */
  notImplemented() {
    return new Error("Method not implemented");
  }

  /**
   * Provide may be implemented in a sub-class if the service should resolve to
   * something other than the instance of the sub-class such as a factory
   * function or an instance from a 3rd party package.
   *
   * @return {any}
   */
  provide() {
    throw this.notImplemented();
  }
}

/**
 * Service is a special-case provider that provides itself. It is typically used
 * as the base class when implementing implement application code to avoid the
 * unnecessary boilerplate of writing a separate provider for each class.
 *
 * @abstract
 */
export class Service extends BaseProvider {
  provide() {
    return this;
  }
}

/**
 * Provider is a base class that can be extended to provide an instance of any
 * type while supporting injected dependencies and lifecycle hooks. It is
 * typically used to wire up external dependencies.
 *
 * @abstract
 * @template T
 */
export class Provider extends BaseProvider {
  /**
   * Create a new provider class that always resolves to the same value.
   *
   * @template T
   * @param {T} value
   * @return {typeof Provider<T>}
   */
  static fromValue(value) {
    return (
      /**
       * @extends Provider<T>
       */
      class extends Provider {
        provide() {
          return value;
        }
      }
    );
  }

  /**
   * Provide must be implemented by a provider and returns the provided
   * instance.
   *
   * @return {T}
   */
  provide() {
    throw this.notImplemented();
  }
}
