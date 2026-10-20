import { TasksPage } from "@/components/crm/tasks-page";

export default function TasksRoute() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tarefas</h1>
        <p className="text-muted-foreground">Ligações, mensagens e reuniões agendadas com os seus leads</p>
      </div>
      <TasksPage />
    </div>
  );
}
