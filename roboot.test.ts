import { Provider, Service, Container, valueProvider } from "./roboot";

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
});
