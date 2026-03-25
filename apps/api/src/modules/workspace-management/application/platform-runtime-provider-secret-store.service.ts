import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type { ManagedRuntimeProvider } from "./runtime-provider-profile";
import {
  PERSAI_RUNTIME_PROVIDER_SECRET_IDS,
  type PlatformRuntimeProviderKeyMetadata
} from "./platform-runtime-provider-settings";
import { TOOL_CREDENTIAL_IDS, CREDENTIAL_KEY_BY_SECRET_ID } from "./tool-credential-settings";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const AES_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const PROVIDER_KEY_BY_SECRET_ID: Record<string, string> = {};
for (const [provider, secretId] of Object.entries(PERSAI_RUNTIME_PROVIDER_SECRET_IDS)) {
  PROVIDER_KEY_BY_SECRET_ID[secretId] = provider;
}
for (const [credentialKey, secretId] of Object.entries(TOOL_CREDENTIAL_IDS)) {
  PROVIDER_KEY_BY_SECRET_ID[secretId] = credentialKey;
}

@Injectable()
export class PlatformRuntimeProviderSecretStoreService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  assertEncryptionConfigured(): void {
    void this.getDerivedEncryptionKey();
  }

  async loadKeyMetadata(): Promise<
    Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata>
  > {
    const rows = await this.prisma.platformRuntimeProviderSecret.findMany({
      where: {
        providerKey: {
          in: ["openai", "anthropic"]
        }
      },
      select: {
        providerKey: true,
        lastFour: true,
        updatedAt: true
      }
    });

    const metadata: Record<ManagedRuntimeProvider, PlatformRuntimeProviderKeyMetadata> = {
      openai: {
        configured: false,
        lastFour: null,
        updatedAt: null
      },
      anthropic: {
        configured: false,
        lastFour: null,
        updatedAt: null
      }
    };

    for (const row of rows) {
      const provider = row.providerKey;
      if (provider !== "openai" && provider !== "anthropic") {
        continue;
      }
      metadata[provider] = {
        configured: true,
        lastFour: row.lastFour,
        updatedAt: row.updatedAt.toISOString()
      };
    }

    return metadata;
  }

  async loadKeyMetadataByKeys(
    keys: string[]
  ): Promise<Record<string, PlatformRuntimeProviderKeyMetadata>> {
    if (keys.length === 0) {
      return {};
    }
    const rows = await this.prisma.platformRuntimeProviderSecret.findMany({
      where: { providerKey: { in: keys } },
      select: {
        providerKey: true,
        lastFour: true,
        updatedAt: true
      }
    });
    const result: Record<string, PlatformRuntimeProviderKeyMetadata> = {};
    for (const row of rows) {
      result[row.providerKey] = {
        configured: true,
        lastFour: row.lastFour,
        updatedAt: row.updatedAt.toISOString()
      };
    }
    return result;
  }

  async upsertProviderKey(
    providerKey: string,
    rawKey: string,
    updatedByUserId: string
  ): Promise<void> {
    const normalized = rawKey.trim();
    if (normalized.length === 0) {
      return;
    }
    const encrypted = this.encrypt(normalized);
    await this.prisma.platformRuntimeProviderSecret.upsert({
      where: { providerKey },
      create: {
        providerKey,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        lastFour: normalized.slice(-4),
        updatedByUserId
      },
      update: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        lastFour: normalized.slice(-4),
        updatedByUserId
      }
    });
  }

  async resolveSecretValueById(secretId: string): Promise<string> {
    const providerKey = PROVIDER_KEY_BY_SECRET_ID[secretId];
    if (providerKey === undefined) {
      throw new Error(`Unsupported PersAI-managed runtime secret id "${secretId}".`);
    }
    const row = await this.prisma.platformRuntimeProviderSecret.findUnique({
      where: { providerKey },
      select: {
        ciphertext: true,
        iv: true,
        authTag: true
      }
    });
    if (row === null) {
      throw new Error(`PersAI-managed runtime secret "${secretId}" is not configured.`);
    }
    return this.decrypt(row);
  }

  private encrypt(value: string): { ciphertext: string; iv: string; authTag: string } {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(AES_ALGORITHM, this.getDerivedEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64")
    };
  }

  private decrypt(row: { ciphertext: string; iv: string; authTag: string }): string {
    const decipher = createDecipheriv(
      AES_ALGORITHM,
      this.getDerivedEncryptionKey(),
      Buffer.from(row.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  private getDerivedEncryptionKey(): Buffer {
    const apiConfig = loadApiConfig(process.env);
    const configured = apiConfig.RUNTIME_PROVIDER_SECRETS_MASTER_KEY?.trim();
    if (!configured) {
      throw new Error(
        "RUNTIME_PROVIDER_SECRETS_MASTER_KEY must be configured before PersAI-managed runtime provider keys can be used."
      );
    }
    return createHash("sha256").update(configured).digest();
  }
}
