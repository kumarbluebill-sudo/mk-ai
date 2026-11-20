import { ChatInterface } from "@/components/chat-interface";

export const metadata = {
  title: "Chat with AI Travel Assistant - MK AI Travel",
  description: "Chat with our AI travel planning assistant to plan your next adventure",
};

export default function ChatPage() {
  return (
    <div style={{ display: "flex", height: "100vh", width: "100%" }}>
      <ChatInterface />
    </div>
  );
}
