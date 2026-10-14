import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";

// Server-built pages put the recipe inside #app for crawlers; the app
// replaces it so nothing shows twice.
const target = document.getElementById("app");
target.replaceChildren();
mount(App, { target });
