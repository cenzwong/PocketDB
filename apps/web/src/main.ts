import { mountApp } from "./app";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");

if (!app) {
  throw new Error("The PocketDB app mount point is missing.");
}

mountApp(app);
