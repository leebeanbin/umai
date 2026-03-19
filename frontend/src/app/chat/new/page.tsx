import { redirect } from "next/navigation";
import { randomUUID } from "crypto";

export default function NewChat() {
  const id = randomUUID();
  redirect(`/chat/${id}`);
}
