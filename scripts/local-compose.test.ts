import { describe, expect, it } from "vitest";
import { composeInvocation } from "./local-compose";

describe("local compose engine selection", () => {
  it("uses ordinary Docker Compose by default without implicit privilege", () => {
    expect(composeInvocation(["up", "-d"], {})).toEqual({
      command: "docker",
      args: ["compose", "up", "-d"],
    });
  });
  it("supports explicit rootful Podman without leaking app credentials into arguments", () => {
    const result = composeInvocation(["up"], {
      CONTAINER_ENGINE: "podman",
      CONTAINER_USE_SUDO: "1",
      PODMAN_COMPOSE_PROVIDER: "/local/docker-compose",
      DATABASE_URL: "private",
    });
    expect(result).toEqual({
      command: "sudo",
      args: [
        "-n",
        "env",
        "PODMAN_COMPOSE_PROVIDER=/local/docker-compose",
        "podman",
        "compose",
        "up",
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("does not execute arbitrary engine names", () => {
    expect(() =>
      composeInvocation([], { CONTAINER_ENGINE: "shell; command" }),
    ).toThrow(/must be/);
  });
});
