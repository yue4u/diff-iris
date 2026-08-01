import { createVaporApp } from "vue";
import ReportApp from "./ReportApp.vue";
import type { Report } from "../shared/types.ts";

type ClientReport = Report & {
  semver: Record<string, [number, number, number] | null>;
  diffIrisVersion: string;
};

const data = document.querySelector<HTMLScriptElement>("#report-data");
if (!data) throw new Error("report data was not found");
createVaporApp(ReportApp, { report: JSON.parse(data.textContent) as ClientReport }).mount("#app");
