import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import type {
  CreateMediaPackageCatalogItemInput,
  MediaPackageCatalogItemState,
  MediaPackageType,
  PackageCurrency,
  UpdateMediaPackageCatalogItemInput
} from "./media-package.types";
import { MEDIA_PACKAGE_TYPES, SUPPORTED_PACKAGE_CURRENCIES } from "./media-package.types";

function isMediaPackageType(value: unknown): value is MediaPackageType {
  return MEDIA_PACKAGE_TYPES.includes(value as MediaPackageType);
}

function isPackageCurrency(value: unknown): value is PackageCurrency {
  return SUPPORTED_PACKAGE_CURRENCIES.includes(value as PackageCurrency);
}

function toItemState(row: {
  id: string;
  packageType: string;
  units: number;
  amountMinor: number;
  currency: string;
  isActive: boolean;
  displayOrder: number;
  highlighted: boolean;
  titleRu: string;
  titleEn: string;
  subtitleRu: string;
  subtitleEn: string;
  ctaLabelRu: string;
  ctaLabelEn: string;
  createdAt: Date;
  updatedAt: Date;
}): MediaPackageCatalogItemState {
  return {
    id: row.id,
    packageType: row.packageType as MediaPackageType,
    units: row.units,
    amountMinor: row.amountMinor,
    currency: row.currency as PackageCurrency,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    highlighted: row.highlighted,
    title: { ru: row.titleRu, en: row.titleEn },
    subtitle: { ru: row.subtitleRu, en: row.subtitleEn },
    ctaLabel: { ru: row.ctaLabelRu, en: row.ctaLabelEn },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

@Injectable()
export class ManageMediaPackageCatalogService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listAll(): Promise<MediaPackageCatalogItemState[]> {
    const rows = await this.prisma.mediaPackageCatalogItem.findMany({
      orderBy: [{ packageType: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }]
    });
    return rows.map(toItemState);
  }

  async listPublic(): Promise<MediaPackageCatalogItemState[]> {
    const rows = await this.prisma.mediaPackageCatalogItem.findMany({
      where: { isActive: true },
      orderBy: [{ packageType: "asc" }, { displayOrder: "asc" }]
    });
    return rows.map(toItemState);
  }

  async getById(id: string): Promise<MediaPackageCatalogItemState> {
    const row = await this.prisma.mediaPackageCatalogItem.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`Media package catalog item "${id}" was not found.`);
    }
    return toItemState(row);
  }

  async create(input: CreateMediaPackageCatalogItemInput): Promise<MediaPackageCatalogItemState> {
    this.validateInput(input);
    const row = await this.prisma.mediaPackageCatalogItem.create({
      data: {
        packageType: input.packageType,
        units: input.units,
        amountMinor: input.amountMinor,
        currency: input.currency,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
        highlighted: input.highlighted ?? false,
        titleRu: input.titleRu,
        titleEn: input.titleEn,
        subtitleRu: input.subtitleRu ?? "",
        subtitleEn: input.subtitleEn ?? "",
        ctaLabelRu: input.ctaLabelRu ?? "",
        ctaLabelEn: input.ctaLabelEn ?? ""
      }
    });
    return toItemState(row);
  }

  async update(
    id: string,
    input: UpdateMediaPackageCatalogItemInput
  ): Promise<MediaPackageCatalogItemState> {
    await this.getById(id);
    if (input.packageType !== undefined && !isMediaPackageType(input.packageType)) {
      throw new BadRequestException("Invalid package type.");
    }
    if (input.currency !== undefined && !isPackageCurrency(input.currency)) {
      throw new BadRequestException("Currency must be RUB or USD.");
    }
    if (input.units !== undefined && (input.units <= 0 || !Number.isInteger(input.units))) {
      throw new BadRequestException("units must be a positive integer.");
    }
    if (
      input.amountMinor !== undefined &&
      (input.amountMinor <= 0 || !Number.isInteger(input.amountMinor))
    ) {
      throw new BadRequestException("amountMinor must be a positive integer.");
    }
    const row = await this.prisma.mediaPackageCatalogItem.update({
      where: { id },
      data: {
        ...(input.packageType !== undefined && { packageType: input.packageType }),
        ...(input.units !== undefined && { units: input.units }),
        ...(input.amountMinor !== undefined && { amountMinor: input.amountMinor }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.displayOrder !== undefined && { displayOrder: input.displayOrder }),
        ...(input.highlighted !== undefined && { highlighted: input.highlighted }),
        ...(input.titleRu !== undefined && { titleRu: input.titleRu }),
        ...(input.titleEn !== undefined && { titleEn: input.titleEn }),
        ...(input.subtitleRu !== undefined && { subtitleRu: input.subtitleRu }),
        ...(input.subtitleEn !== undefined && { subtitleEn: input.subtitleEn }),
        ...(input.ctaLabelRu !== undefined && { ctaLabelRu: input.ctaLabelRu }),
        ...(input.ctaLabelEn !== undefined && { ctaLabelEn: input.ctaLabelEn })
      }
    });
    return toItemState(row);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    const hasGrants = await this.prisma.workspaceMediaPackageGrant.count({
      where: { packageCatalogItemId: id }
    });
    if (hasGrants > 0) {
      throw new BadRequestException(
        "Cannot delete a package catalog item that has been purchased. Deactivate it instead."
      );
    }
    await this.prisma.mediaPackageCatalogItem.delete({ where: { id } });
  }

  private validateInput(input: CreateMediaPackageCatalogItemInput): void {
    if (!isMediaPackageType(input.packageType)) {
      throw new BadRequestException(
        `packageType must be one of: ${MEDIA_PACKAGE_TYPES.join(", ")}.`
      );
    }
    if (!Number.isInteger(input.units) || input.units <= 0) {
      throw new BadRequestException("units must be a positive integer.");
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException(
        "amountMinor must be a positive integer (price in kopecks/cents)."
      );
    }
    if (!isPackageCurrency(input.currency)) {
      throw new BadRequestException("currency must be RUB or USD.");
    }
    if (input.titleRu.trim().length === 0 || input.titleEn.trim().length === 0) {
      throw new BadRequestException("titleRu and titleEn are required.");
    }
  }
}
