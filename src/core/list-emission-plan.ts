import type {
  ListItemChildEmissionPlan,
  ListItemRenderPlan,
  ListRenderPlan,
} from "./block-render-plan";
import { listItemEmissionPlan } from "./block-render-plan";
import type {
  ListItemSurfaceOptions,
  ListSurfaceOptions,
} from "./list-surface";

export interface ListItemSurfaceEmissionPlan {
  readonly markerNumber: number;
  readonly options: ListItemSurfaceOptions;
  readonly childPlans: readonly ListItemChildEmissionPlan[];
}

export interface ListSurfaceEmissionPlan {
  readonly options: ListSurfaceOptions;
  readonly items: readonly ListItemSurfaceEmissionPlan[];
}

export function listItemSurfaceEmissionPlan(
  ordered: boolean,
  plan: ListItemRenderPlan,
): ListItemSurfaceEmissionPlan {
  return {
    markerNumber: plan.markerNumber,
    options: {
      ordered,
      task: plan.task !== null,
      checked: plan.task?.checked,
    },
    childPlans: listItemEmissionPlan(plan),
  };
}

export function listSurfaceEmissionPlan(
  plan: ListRenderPlan,
): ListSurfaceEmissionPlan {
  return {
    options: {
      ordered: plan.ordered,
      task: plan.task,
      loose: plan.loose,
      start: plan.start,
    },
    items: plan.items.map((item) => listItemSurfaceEmissionPlan(plan.ordered, item)),
  };
}
