// @ts-check
import assert from "node:assert";
import { Provider, Service, Container } from "./roboot.mjs";

test("boots an returns an instance of a single root service", async () => {
  class TestService extends Service {}
  let testService = await new Container().boot(TestService);
  assert(testService instanceof TestService);
});

test("calling use returns instance provided by service class", async () => {
  let provided = {};
  class Dependency extends Service {}
  class TestProvider extends Provider {
    provide() {
      return provided;
    }
  }
  class TestService extends Service {
    dependency = this.use(Dependency);
    provider = this.use(TestProvider);
  }
  let testService = await new Container().boot(TestService);
  assert(testService.dependency instanceof Dependency);
  assert.equal(testService.provider, provided);
});

test("use resolves same instance in subsequent calls", async () => {
  class Dependency extends Service {}
  class TestService extends Service {
    a = this.use(Dependency);
    b = this.use(Dependency);
  }
  let testService = await new Container().boot(TestService);
  assert.equal(testService.a, testService.b);
});

test("all circular references resolved when boot is called", async () => {
  /** @type {unknown} */
  let ab;
  /** @type {unknown} */
  let ba;
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
  assert.equal(/** @type {B} */ (ab).a, ba);
  assert.equal(/** @type {A} */ (ba).b, ab);
});

test("boot dependency order", async () => {
  let order = [];
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
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test("dispose dependency order", async () => {
  let order = [];
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
    async dispose(instance) {
      order.push(2);
      await this.disposed(Dependency);
      order.push(4);
    }
  }
  let container = new Container();
  await container.boot(TestService);
  await container.dispose();
  assert.deepEqual(order, [1, 2, 3, 4]);
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
  assert(testService.dependency instanceof ExtendedDependency);
});

test("provider for static value", async () => {
  let value = { test: true };
  class TestService extends Service {
    value = this.use(Provider.fromValue(value));
  }
  let testService = await new Container().boot(TestService);
  assert.equal(testService.value, value);
});

test("apply calls function with container instance in chain", async () => {
  let applied;
  let container = new Container().apply((c) => (applied = c));
  assert.equal(applied, container);
  assert(container instanceof Container);
});

// ============================================================================
// Simple test runner
// ============================================================================

/**
 * @param {string} name
 * @param {Function} [func]
 */
function test(name, func = async () => assert.fail("TODO")) {
  test["cases"] = test["cases"] ?? [];
  test["cases"].push({ name, func });
}

(async () => {
  let start = Date.now();
  let red = (str) => `\x1b[31m${str}\x1b[0m`;
  let green = (str) => `\x1b[32m${str}\x1b[0m`;
  let failed = 0;
  for (let c of test["cases"] ?? []) {
    try {
      await c.func();
      console.log(" ", green("✔"), c.name);
    } catch (err) {
      failed += 1;
      console.log(" ", red("✘"), c.name);
      console.log(
        `\n${err.stack
          .split("\n")
          .map((ln) => `    ${ln}`)
          .join("\n")}\n`
      );
    }
  }
  let passed = (test["cases"]?.length ?? 0) - failed;
  console.log("\nTests passed:", green(passed));
  console.log("Tests failed:", (failed > 0 ? red : green)(failed));
  console.log("Duration:", green(`${Date.now() - start}ms`));
  if (failed > 0) {
    console.log(red("\nFAIL\n"));
    process.exit(1);
  } else {
    console.log(green("\nPASS\n"));
    process.exit(0);
  }
})();
