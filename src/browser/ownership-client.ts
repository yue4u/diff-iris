import { createVaporApp } from "vue";
import OwnershipApp from "./OwnershipApp.vue";
import type { OwnershipReport } from "../shared/ownership-types.ts";

const data = document.querySelector<HTMLScriptElement>("#ownership-data");
if (!data) throw new Error("ownership report data was not found");
createVaporApp(OwnershipApp, { report: JSON.parse(data.textContent) as OwnershipReport }).mount(
  "#ownership-app",
);
