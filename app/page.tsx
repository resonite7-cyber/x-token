import { redirect } from "next/navigation";

/** The app is Robinhood Chain only now; the market is the front door. */
export default function Home() {
  redirect("/pons");
}
