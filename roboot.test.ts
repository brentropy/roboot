import {
  Provider,
  Service,
  Container,
  valueProvider,
  Registry,
} from "./roboot";

describe("Roboot", () => {
  test("boots an returns an instance of a single root service", async () => {
    class TestService extends Service {}
    let testService = await new Container().boot(TestService);
    expect(testService).toBeInstanceOf(TestService);
  });

  test("calling use returns instance provided by service class", async () => {
    let provided = {};
    class Dependency extends Service {}
    class TestProvider extends Provider<object> {
      provide() {
        return provided;
      }
    }
    class TestService extends Service {
      dependency = this.use(Dependency);
      provider = this.use(TestProvider);
    }
    let testService = await new Container().boot(TestService);
    expect(testService.dependency).toBeInstanceOf(Dependency);
    expect(testService.provider).toBe(provided);
  });

  test("use resolves same instance in subsequent calls", async () => {
    class Dependency extends Service {}
    class TestService extends Service {
      a = this.use(Dependency);
      b = this.use(Dependency);
    }
    let testService = await new Container().boot(TestService);
    expect(testService.a).toBe(testService.b);
  });

  test("all circular references resolved when boot is called", async () => {
    let ab: B;
    let ba: A;
    class A extends Service {
      b = this.use(B);
      async boot() {
        ab = this.b;
      }
    }
    class B extends Service {
      a = this.use(A);
      async boot() {
        ba = this.a;
      }
    }
    class TestService extends Service {
      a = this.use(A);
      b = this.use(B);
    }
    await new Container().boot(TestService);
    expect(ab!.a).toBe(ba!);
    expect(ba!.b).toBe(ab!);
  });

  test("boot dependency order", async () => {
    let order: number[] = [];
    class Dependency extends Service {
      async boot() {
        order.push(1);
        await Promise.resolve();
        await Promise.resolve();
        order.push(3);
      }
    }
    class TestService extends Service {
      dependency = this.use(Dependency);
      async boot() {
        order.push(2);
        await this.booted(Dependency);
        order.push(4);
      }
    }
    await new Container().boot(TestService);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("dispose dependency order", async () => {
    let order: number[] = [];
    class Dependency extends Service {
      async dispose() {
        order.push(1);
        await Promise.resolve();
        await Promise.resolve();
        order.push(3);
      }
    }
    class TestService extends Service {
      dependency = this.use(Dependency);
      async dispose() {
        order.push(2);
        await this.disposed(Dependency);
        order.push(4);
      }
    }
    let container = new Container();
    await container.boot(TestService);
    await container.dispose();
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("binding alternative service implementations", async () => {
    class Dependency extends Service {}
    class ExtendedDependency extends Dependency {}
    class TestService extends Service {
      dependency = this.use(Dependency);
    }
    let testService = await new Container()
      .bind(Dependency, ExtendedDependency)
      .boot(TestService);
    expect(testService.dependency).toBeInstanceOf(ExtendedDependency);
  });

  test("provider for static value", async () => {
    let value = { test: true };
    class TestService extends Service {
      value = this.use(valueProvider(value));
    }
    let testService = await new Container().boot(TestService);
    expect(testService.value).toBe(value);
  });

  test("apply calls function with container instance in chain", async () => {
    let applied;
    let container = new Container().apply((c) => (applied = c));
    expect(applied).toBe(container);
    expect(container).toBeInstanceOf(Container);
  });

  describe("Registry", () => {
    class TestRegistry<T extends RegisteredBase> extends Registry<T> {}

    abstract class RegisteredBase extends Service {
      registry = TestRegistry;
      abstract value: number;
      isBooted = false;
      isDisposed = false;

      async boot() {
        await Promise.resolve();
        this.isBooted = true;
      }

      async dispose() {
        await Promise.resolve();
        this.isDisposed = true;
      }
    }

    class A extends RegisteredBase {
      value = 1;
    }

    class B extends RegisteredBase {
      value = 2;
    }

    class App extends Service {
      testRegistry = this.use(TestRegistry);
      a = this.use(A);
      b = this.use(B);
    }

    test("forEach", async () => {
      expect.assertions(1);
      class EachTestRegistry<T extends RegisteredBase> extends TestRegistry<T> {
        async boot() {
          let sum = 0;
          this.forEach((registered) => {
            sum += registered.value;
          });
          expect(sum).toBe(3);
        }
      }
      let container = new Container().bind(TestRegistry, EachTestRegistry);
      await container.boot(App);
    });

    test("map", async () => {
      expect.assertions(1);
      class MapTestRegistry<T extends RegisteredBase> extends TestRegistry<T> {
        async boot() {
          let values = this.map((registered) => registered.value * 2);
          expect(values.sort()).toEqual([2, 4]);
        }
      }
      let container = new Container().bind(TestRegistry, MapTestRegistry);
      await container.boot(App);
    });

    test("allBooted", async () => {
      expect.assertions(2);
      class BootedTestRegistry<
        T extends RegisteredBase
      > extends TestRegistry<T> {
        async boot() {
          let beforeAllBooted = this.map((instance) => instance.isBooted);
          await this.allBooted();
          let afterAllBooted = this.map((instance) => instance.isBooted);
          expect(beforeAllBooted).toEqual([false, false]);
          expect(afterAllBooted).toEqual([true, true]);
        }
      }
      let container = new Container().bind(TestRegistry, BootedTestRegistry);
      await container.boot(App);
    });

    test("allDisposed", async () => {
      expect.assertions(2);
      class DisposedTestRegistry<
        T extends RegisteredBase
      > extends TestRegistry<T> {
        async dispose() {
          let beforeAllDisposed = this.map((instance) => instance.isDisposed);
          await this.allDisposed();
          let afterAllDisposed = this.map((instance) => instance.isDisposed);
          expect(beforeAllDisposed).toEqual([false, false]);
          expect(afterAllDisposed).toEqual([true, true]);
        }
      }
      let container = new Container().bind(TestRegistry, DisposedTestRegistry);
      await container.boot(App);
      await container.dispose();
    });

    test("binding alternative service implementations with registry", async () => {
      expect.assertions(1);
      class BootedTestRegistry<
        T extends RegisteredBase
      > extends TestRegistry<T> {
        async boot() {
          await this.allBooted();
          let values = this.map((instance) => instance.value);
          expect(values).toEqual([1, 3]);
        }
      }
      class C extends B {
        override value = 3;
      }
      let container = new Container()
        .bind(TestRegistry, BootedTestRegistry)
        .bind(B, C);
      await container.boot(App);
    });
  });
});
