/**
 * Roboot
 * Copyright (c) 2022 Brent Burgoyne
 * License (MIT): https://github.com/brentropy/roboot/blob/master/LICENSE.md
 * Documentation: https://github.com/brentropy/roboot/blob/master/README.md
 */

/**
 * Container for resolving dependency instances.
 */
export class Container {
  private finalized;
  private bindings;
  private instances;
  private instanceProviders;
  private useStack;
  private unresolvedCircular;
  private make;
  private resolveCircular;
  private bootAll;

  bootedPromises: Map<ProviderClass, Promise<void>> | undefined;

  disposedPromises: Map<ProviderClass, Promise<void>> | undefined;

  /**
   * Use an alternate implementation whenever a provider is used in this
   * container instance.
   */
  bind<T, U>(Provider: ProviderClass, Implementation: ProviderClass): Container;

  /**
   * Return an existing instance for a provider or create a new instance if one
   * doesn't already exist.
   */
  use<P extends ProviderClass>(
    Dependency: P,
    Dependent?: ProviderClass | undefined
  ): ProvidedBy<InstanceType<P>>;

  /**
   * Apply calls a function with the container instance and returns the
   * container instance. This can be useful when with chaining method calls
   * when creating a new container.
   */
  apply(func: (container: Container) => any): Container;

  /**
   * Boot resolves a single root provider and it's dependencies then boot all
   * provided instances.
   */
  boot<P extends ProviderClass>(Root: P): Promise<ProvidedBy<InstanceType<P>>>;

  /**
   * Replace temporary objects returned due to a circular dependency with actual
   * dependency instances.
   */
  dispose(): Promise<void>;
}

/**
 * Service is a special-case provider that provides itself. It is typically used
 * as the base class when implementing implement application code to avoid the
 * unnecessary boilerplate of writing a separate provider for each class.
 */
export class Service extends BaseProvider {
  provide(): this;
}

/**
 * Provider is a base class that can be extended to provide an instance of any
 * type while supporting injected dependencies and lifecycle hooks. It is
 * typically used to wire up external dependencies.
 */
export class Provider<T> extends BaseProvider {
  /**
   * Create a new provider class that always resolves to the same value.
   */
  static fromValue<T>(value: T): {
    new (container: Container): Provider<T>;
    fromValue<T>(value: T): any;
  };

  constructor(container: Container);

  /**
   * Provide must be implemented by a provider and returns the provided
   * instance.
   */
  provide(): T;
}

export type ProviderClass = typeof BaseProvider;

export type ProvidedBy<T> = T extends {
  provide: () => infer R;
}
  ? R
  : never;

/**
 * Base class used to create provider classes with injectable dependencies.
 */
declare class BaseProvider {
  constructor(container: Container);

  private container;

  /**
   * Use resolve a dependency from the container with dependant tracking to
   * identify and correctly handle circular references.
   */
  protected use<P extends typeof BaseProvider>(
    Dependency: P
  ): ProvidedBy<InstanceType<P>>;

  /**
   * Boot is called on all services after all dependencies are resolved.
   */
  boot(instance: any): Promise<void>;

  /**
   * Booted returns a promise that will be resolved after the dependency has
   * finished booting.
   */
  protected booted(Dependency: ProviderClass): Promise<void>;

  /**
   * Dispose is called on all services when dispose is called on the container.
   */
  dispose(instance: any): Promise<void>;

  /**
   * Disposed returns a promise that will be resolved after the dependency has
   * finished disposing.
   */
  protected disposed(Dependency: ProviderClass): Promise<void>;

  /**
   * Create a new not implemented error instance that can be thrown in methods
   * of abstract providers that must be implemented by a child class.
   */
  protected notImplemented(): Error;

  /**
   * Provide may be implemented in a sub-class if the service should resolve to
   * something other than the instance of the sub-class such as a factory
   * function or an instance from a 3rd party package.
   */
  provide(): any;
}

export {};
