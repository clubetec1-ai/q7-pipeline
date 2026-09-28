import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { OrgProvider } from "@/contexts/OrgContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { PhoneWidget } from "@/components/voice/PhoneWidget";
import Login from "./pages/Login";
import Conversas from "./pages/Conversas";
import Kanban from "./pages/Kanban";
import UazapiConfig from "./pages/admin/UazapiConfig";
import NotFound from "./pages/NotFound";
import Equipe from "./pages/Equipe";
import Convite from "./pages/Convite";
import Numeros from "./pages/Numeros";
import Biblioteca from "./pages/Biblioteca";
import Plataforma from "./pages/Plataforma";
import Registros from "./pages/Registros";
import Diagnostico from "./pages/Diagnostico";
import Cobrancas from "./pages/Cobrancas";
import Integracoes from "./pages/Integracoes";
import Supervisor from "./pages/Supervisor";
import Avaliacoes from "./pages/Avaliacoes";
import Campanhas from "./pages/Campanhas";
import Seguranca from "./pages/Seguranca";
import Melhorias from "./pages/Melhorias";
import Conhecimento from "./pages/Conhecimento";
import Clientes from "./pages/Clientes";
import Agente from "./pages/Agente";
import Relatorios from "./pages/Relatorios";
import EtiquetasGrupos from "./pages/EtiquetasGrupos";
import Chat from "./pages/Chat";
import Fluxos from "./pages/Fluxos";
import FlowEditor from "./pages/FlowEditor";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <OrgProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Conversas /></ProtectedRoute>} />
            <Route path="/kanban" element={<ProtectedRoute><Kanban /></ProtectedRoute>} />
            <Route path="/equipe" element={<ProtectedRoute><Equipe /></ProtectedRoute>} />
            <Route path="/numeros" element={<ProtectedRoute><Numeros /></ProtectedRoute>} />
            <Route path="/biblioteca" element={<ProtectedRoute><Biblioteca /></ProtectedRoute>} />
            <Route path="/plataforma" element={<ProtectedRoute><Plataforma /></ProtectedRoute>} />
            <Route path="/registros" element={<ProtectedRoute><Registros /></ProtectedRoute>} />
            <Route path="/diagnostico" element={<ProtectedRoute><Diagnostico /></ProtectedRoute>} />
            <Route path="/cobrancas" element={<ProtectedRoute><Cobrancas /></ProtectedRoute>} />
            <Route path="/integracoes" element={<ProtectedRoute><Integracoes /></ProtectedRoute>} />
            <Route path="/supervisor" element={<ProtectedRoute><Supervisor /></ProtectedRoute>} />
            <Route path="/avaliacoes" element={<ProtectedRoute><Avaliacoes /></ProtectedRoute>} />
            <Route path="/campanhas" element={<ProtectedRoute><Campanhas /></ProtectedRoute>} />
            <Route path="/seguranca" element={<ProtectedRoute><Seguranca /></ProtectedRoute>} />
            <Route path="/melhorias" element={<ProtectedRoute><Melhorias /></ProtectedRoute>} />
            <Route path="/conhecimento" element={<ProtectedRoute><Conhecimento /></ProtectedRoute>} />
            <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
            <Route path="/fluxos" element={<ProtectedRoute><Fluxos /></ProtectedRoute>} />
            <Route path="/fluxos/:id" element={<ProtectedRoute><FlowEditor /></ProtectedRoute>} />
            <Route path="/convite" element={<ProtectedRoute allowWithoutOrg><Convite /></ProtectedRoute>} />
            <Route path="/admin/uazapi" element={<ProtectedRoute><AdminRoute><UazapiConfig /></AdminRoute></ProtectedRoute>} />
            <Route path="/conversas" element={<Navigate to="/" replace />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/agente" element={<ProtectedRoute><Agente /></ProtectedRoute>} />
            <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
            <Route path="/etiquetas" element={<ProtectedRoute><EtiquetasGrupos /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/conectar" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <PhoneWidget />
        </BrowserRouter>
        </TooltipProvider>
        </OrgProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
