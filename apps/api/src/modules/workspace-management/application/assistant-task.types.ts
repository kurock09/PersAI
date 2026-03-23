import type { AssistantTaskRegistryItem } from "../domain/assistant-task-registry-item.entity";

export type AssistantTaskRegistryItemState = {
  id: string;
  title: string;
  sourceSurface: AssistantTaskRegistryItem["sourceSurface"];
  sourceLabel: string | null;
  controlStatus: AssistantTaskRegistryItem["controlStatus"];
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const TASK_LIST_LIMIT = 80;

export function sortTaskRegistryItemsForDisplay(
  items: AssistantTaskRegistryItem[]
): AssistantTaskRegistryItem[] {
  return [...items].sort((a, b) => {
    const aActive = a.controlStatus === "active";
    const bActive = b.controlStatus === "active";
    if (aActive !== bActive) {
      return aActive ? -1 : 1;
    }
    if (aActive && bActive) {
      const at = a.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (at !== bt) {
        return at - bt;
      }
    }
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}

export { TASK_LIST_LIMIT };
