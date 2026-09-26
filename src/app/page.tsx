import { ViewTransition } from "react";
import { HomeClient } from "@/components/home/HomeClient";
import { PAGE_TRANSITION } from "@/components/home/transitions";

/** Home: server status, upload → analysis → new project, and the project library. */
export default function Home() {
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <HomeClient />
    </ViewTransition>
  );
}
