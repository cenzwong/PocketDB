import "./styles.css";
import "./distributed.css";
import { mountDistributedConsole } from "./distributed-console";

const root = document.querySelector<HTMLElement>("#distributed-app");
if (!root) throw new Error("The distributed console mount point is missing.");
mountDistributedConsole(root);
