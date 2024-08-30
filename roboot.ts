/**
 * Roboot
 * Copyright (c) 2022 Brent Burgoyne
 * License (MIT): https://github.com/brentropy/roboot/blob/master/LICENSE.md
 * Documentation: https://github.com/brentropy/roboot/blob/master/README.md
 */

interface IProvider<T> {
  boot?(instance: T): Promise<void>;
  dispose?(instance: T): Promise<void>;
  provide(): T;
}

type ProviderClass<T = unknown> = new (container: Container) => IProvider<T>;

type UnresolvedCircular = {
  temp: Object;
  Dependent: ProviderClass;
  Dependency: ProviderClass;
};

/**
 * Container for resolving dependency instances.
 */
export class Container {
  private finalized = false;
  private bindings = new Map<ProviderClass, ProviderClass>();
  private instances = new Map<ProviderClass, any>();
  private instanceProviders = new Map<any, IProvider<unknown>>();
  private useStack: ProviderClass[] = [];
  private unresolvedCircular: UnresolvedCircular[] = [];

  bootedPromises?: Map<ProviderClass, Promise<void>>;
  disposedPromises?: Map<ProviderClass, Promise<void>>;

  /**
   * Use an alternate implementation whenever a provider is used in this
   * container instance.
   */
  bind<T extends ProviderClass, U extends T>(Provider: T, Implementation: U) {
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
   */
  use<I>(Dependency: ProviderClass<I>, Dependent?: ProviderClass): I {
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
  make<I>(Dependency: ProviderClass<I>): I {
    let Implementation =
      (this.bindings.get(Dependency) as ProviderClass<I>) ?? Dependency;
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
   */
  apply(func: (container: Container) => any) {
    func(this);
    return this;
  }

  /**
   * Boot resolves a single root provider and it's dependencies then boot all
   * provided instances.
   */
  async boot<I>(Root: ProviderClass<I>): Promise<I> {
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
   */
  private async resolveCircular(): Promise<void> {
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
   */
  private async bootAll(): Promise<void> {
    this.bootedPromises = new Map(
      [...this.instances.entries()].map(([Class, instance]) => [
        Class,
        Promise.resolve().then(() =>
          this.instanceProviders.get(instance)?.boot?.(instance)
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
          this.instanceProviders.get(instance)?.dispose?.(instance)
        ),
      ])
    );
    await Promise.all(this.disposedPromises.values());
  }
}
abstract class Injectable {
  constructor(private container: Container) {}

  /**
   * Use resolve a dependency from the container with dependant tracking to
   * identify and correctly handle circular references.
   */
  protected use<I>(Dependency: ProviderClass<I>): I {
    return this.container.use(Dependency, this.constructor as ProviderClass);
  }

  /**
   * Booted returns a promise that will be resolved after the dependency has
   * finished booting.
   */
  protected booted(Dependency: ProviderClass): Promise<void> {
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
   * Disposed returns a promise that will be resolved after the dependency has
   * finished disposing.
   *
   * @protected
   * @param {ProviderClass} Dependency
   * @return {Promise<void>}
   */
  protected disposed(Dependency: ProviderClass): Promise<void> {
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
}

/**
 * Provider is a base class that can be extended to provide an instance of any
 * type while supporting injected dependencies and lifecycle hooks. It is
 * typically used to wire up external dependencies.
 */
export abstract class Provider<T> extends Injectable {
  abstract provide(): T;
}

/**
 * Service is a special-case provider that provides itself. It is typically used
 * as the base class when implementing implement application code to avoid the
 * unnecessary boilerplate of writing a separate provider for each class.
 */
export abstract class Service extends Injectable {
  provide() {
    return this;
  }
}

export function valueProvider<T>(value: T): ProviderClass<T> {
  return class extends Provider<T> {
    provide(): T {
      return value;
    }
  };
}
