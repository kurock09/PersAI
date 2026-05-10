/**
 * ADR-088 Slice 2.5 closeout — ResolveWorkspaceNotificationChannelsService.
 *
 * Covers:
 *   - email available iff workspace owner AppUser.email is non-empty
 *   - telegram_thread requires AssistantChannelSurfaceBinding bindingState=active
 *   - web_thread / web_notification_center always available even with no
 *     registry row or registry row disabled
 *   - admin_webhook unavailable when registry url empty
 *   - policy + quiet hours fall back to NOTIFICATION_*_DEFAULTS when DB empty
 */

import assert from "node:assert/strict";
import { ResolveWorkspaceNotificationChannelsService } from "../src/modules/workspace-management/application/notifications/resolve-workspace-notification-channels.service";
import { NOTIFICATION_POLICY_DEFAULTS } from "../src/modules/workspace-management/application/notifications/defaults/notification-defaults";

type ChannelRow = {
  id: string;
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  healthStatus: string;
};

type PolicyRow = {
  id: string;
  source: string;
  enabled: boolean;
  channels: string[];
  cooldownMinutes: number | null;
  maxPerDay: number | null;
  escalationAfterMinutes: number | null;
  escalationChannel: string | null;
  respectQuietHours: boolean;
  renderStrategy: string;
  renderInstructionRef: string | null;
  templateId: string | null;
  config: Record<string, unknown>;
};

type QuietHoursRow = {
  id: string;
  enabled: boolean;
  startLocal: string;
  endLocal: string;
  timezoneMode: string;
  defaultTimezone: string | null;
  appliesToSources: string[];
};

type Binding = {
  bindingState: "active" | "inactive" | "unconfigured";
};

type WorkspaceMember = {
  user: { email: string } | null;
};

type Fixture = {
  channels?: ChannelRow[];
  policies?: PolicyRow[];
  quietHours?: QuietHoursRow | null;
  bindings?: Binding[];
  workspaceMember?: WorkspaceMember | null;
};

function makePrisma(fixture: Fixture) {
  const channels = fixture.channels ?? [];
  const policies = fixture.policies ?? [];
  const quietHours = fixture.quietHours ?? null;
  const bindings = fixture.bindings ?? [];
  const workspaceMember = fixture.workspaceMember ?? null;

  return {
    notificationChannelRegistry: {
      findUnique: async (q: { where: { channelType: string } }) =>
        channels.find((c) => c.channelType === q.where.channelType) ?? null
    },
    notificationPolicy: {
      findUnique: async (q: { where: { source: string } }) =>
        policies.find((p) => p.source === q.where.source) ?? null
    },
    notificationQuietHours: {
      findFirst: async () => quietHours
    },
    assistantChannelSurfaceBinding: {
      findFirst: async (q: {
        where: {
          assistant?: { workspaceId: string };
          providerKey?: string;
          bindingState?: string;
        };
      }) => {
        const requested = q.where.bindingState ?? null;
        return (
          bindings.find((b) => {
            if (requested && b.bindingState !== requested) return false;
            return true;
          }) ?? null
        );
      }
    },
    workspaceMember: {
      findFirst: async () => workspaceMember
    }
  };
}

function makeResolver(fixture: Fixture) {
  const prisma = makePrisma(fixture);
  return new ResolveWorkspaceNotificationChannelsService(prisma as never);
}

void (async function run(): Promise<void> {
  // 1. email available when workspace owner has AppUser.email
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-email",
          channelType: "email",
          enabled: true,
          config: { sendingDomain: "notifications.persai.dev" },
          healthStatus: "healthy"
        }
      ],
      workspaceMember: { user: { email: "owner@example.com" } }
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "email"
    });
    assert.equal(result.available, true, "email available with owner email");
    assert.ok(result.available);
    assert.equal(
      (result.channel.config as Record<string, unknown>)["toAddress"],
      "owner@example.com",
      "resolved owner email merged into config"
    );
    console.log("✓ email available when owner has AppUser.email");
  }

  // 1b. email also falls back to code defaults when registry row is missing
  {
    const resolver = makeResolver({
      channels: [],
      workspaceMember: { user: { email: "owner@example.com" } }
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "email"
    });
    assert.equal(result.available, true, "email available from defaults when row missing");
    assert.ok(result.available);
    assert.equal(
      (result.channel.config as Record<string, unknown>)["sendingDomain"],
      "notifications.persai.dev"
    );
    assert.equal(result.channel.healthStatus, "unconfigured");
    console.log("✓ email falls back to global defaults when registry row is missing");
  }

  // 2. email unavailable when owner email empty → reason auto_derive_unavailable
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-email",
          channelType: "email",
          enabled: true,
          config: {},
          healthStatus: "healthy"
        }
      ],
      workspaceMember: { user: { email: "" } }
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "email"
    });
    assert.equal(result.available, false, "email unavailable when owner has no email");
    assert.ok(!result.available);
    assert.equal(result.reason, "auto_derive_unavailable");
    console.log("✓ email unavailable when owner email empty");
  }

  // 3. telegram_thread available iff binding bindingState=active exists
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-tg",
          channelType: "telegram_thread",
          enabled: true,
          config: {},
          healthStatus: "healthy"
        }
      ],
      bindings: [{ bindingState: "active" }]
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "telegram_thread"
    });
    assert.equal(result.available, true, "telegram available with active binding");
    console.log("✓ telegram_thread available when binding bindingState=active");
  }

  // 4. telegram_thread unavailable when no active binding → reason channel_unhealthy
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-tg",
          channelType: "telegram_thread",
          enabled: true,
          config: {},
          healthStatus: "healthy"
        }
      ],
      bindings: [{ bindingState: "unconfigured" }]
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "telegram_thread"
    });
    assert.equal(result.available, false, "telegram unavailable without active binding");
    assert.ok(!result.available);
    assert.equal(result.reason, "channel_unhealthy");
    console.log("✓ telegram_thread unavailable when binding not active");
  }

  // 5. web_thread always available regardless of registry row absence/disabled
  {
    const resolver = makeResolver({ channels: [] });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "web_thread"
    });
    assert.equal(result.available, true, "web_thread available with no registry row");

    const resolverDisabled = makeResolver({
      channels: [
        {
          id: "ch-wt",
          channelType: "web_thread",
          enabled: false,
          config: {},
          healthStatus: "unconfigured"
        }
      ]
    });
    const result2 = await resolverDisabled.resolveChannel({
      workspaceId: "ws-1",
      channelType: "web_thread"
    });
    assert.equal(result2.available, true, "web_thread available even when registry row disabled");
    console.log("✓ web_thread always available regardless of registry row state");
  }

  // 5b. web_notification_center always available too
  {
    const resolver = makeResolver({ channels: [] });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "web_notification_center"
    });
    assert.equal(result.available, true, "web_notification_center always available");
    console.log("✓ web_notification_center always available");
  }

  // 6. admin_webhook unavailable when registry url empty → reason auto_derive_unavailable
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-aw",
          channelType: "admin_webhook",
          enabled: true,
          config: {},
          healthStatus: "healthy"
        }
      ]
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "admin_webhook"
    });
    assert.equal(result.available, false, "admin_webhook unavailable without webhookUrl");
    assert.ok(!result.available);
    assert.equal(result.reason, "auto_derive_unavailable");
    console.log("✓ admin_webhook unavailable when webhookUrl empty");
  }

  // 6b. admin_webhook disabled-globally → reason channel_disabled_globally
  {
    const resolver = makeResolver({
      channels: [
        {
          id: "ch-aw",
          channelType: "admin_webhook",
          enabled: false,
          config: { webhookUrl: "https://example.test/hook" },
          healthStatus: "healthy"
        }
      ]
    });
    const result = await resolver.resolveChannel({
      workspaceId: "ws-1",
      channelType: "admin_webhook"
    });
    assert.equal(result.available, false);
    assert.ok(!result.available);
    assert.equal(result.reason, "channel_disabled_globally");
    console.log("✓ admin_webhook disabled globally → channel_disabled_globally");
  }

  // 7. policy/quiet-hours fall back to NOTIFICATION_*_DEFAULTS when DB empty
  {
    const resolver = makeResolver({});
    const policy = await resolver.resolvePolicy("quota_advisory");
    const expected = NOTIFICATION_POLICY_DEFAULTS["quota_advisory"];
    assert.equal(policy.enabled, expected.enabled);
    assert.deepEqual(policy.channels, expected.channels);
    assert.equal(policy.respectQuietHours, expected.respectQuietHours);
    assert.equal(policy.renderStrategy, expected.renderStrategy);

    const quietHours = await resolver.resolveQuietHours();
    assert.equal(quietHours.enabled, false, "quiet hours default disabled");
    assert.equal(quietHours.startLocal, "22:00");
    assert.equal(quietHours.endLocal, "08:00");
    assert.deepEqual(quietHours.appliesToSources, []);
    console.log("✓ resolvePolicy/resolveQuietHours fall back to defaults when DB empty");
  }

  // 7b. resolvePolicy returns DB row when present (overrides defaults)
  {
    const resolver = makeResolver({
      policies: [
        {
          id: "pol-1",
          source: "idle_reengagement",
          enabled: true,
          channels: ["telegram_thread"],
          cooldownMinutes: 30,
          maxPerDay: 5,
          escalationAfterMinutes: 60,
          escalationChannel: "email",
          respectQuietHours: false,
          renderStrategy: "static_fallback",
          renderInstructionRef: null,
          templateId: null,
          config: { custom: true }
        }
      ]
    });
    const policy = await resolver.resolvePolicy("idle_reengagement");
    assert.equal(policy.cooldownMinutes, 30);
    assert.deepEqual(policy.channels, ["telegram_thread"]);
    assert.equal(policy.respectQuietHours, false);
    assert.equal(policy.renderStrategy, "static_fallback");
    console.log("✓ resolvePolicy reads DB row when present");
  }

  console.log("\n✅ All resolve-workspace-notification-channels.service tests passed");
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
