import ConfigPlano from "./pages/ConfigPlano";
import Planos from "./pages/Planos";
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
import { OrgTheme } from "@/components/OrgTheme";
import { ModuleGate } from "@/components/ModuleGate";
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
import Funil from "./pages/Funil";
import EtiquetasGrupos from "./pages/EtiquetasGrupos";
import Chat from "./pages/Chat";
import Fluxos from "./pages/Fluxos";
import Inicio from "./pages/Inicio";
import Configuracoes from "./pages/Configuracoes";
import Setores from "./pages/Setores";
import ConfigCobrancas from "./pages/ConfigCobrancas";
import ConfigIA from "./pages/ConfigIA";
import ConfigAtendimento from "./pages/ConfigAtendimento";
import ConfigAparencia from "./pages/ConfigAparencia";
import ConfigAreas from "./pages/ConfigAreas";
import Cerebro from "./pages/Cerebro";
import FlowEditor from "./pages/FlowEditor";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <OrgProvider>
        <TooltipProvider>
        <OrgTheme />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/planos" element={<Planos />} />
            <Route path="/" element={<ProtectedRoute><Conversas /></ProtectedRoute>} />
            <Route path="/kanban" element={<ProtectedRoute><Kanban /></ProtectedRoute>} />
            <Route path="/equipe" element={<ProtectedRoute><Equipe /></ProtectedRoute>} />
            <Route path="/numeros" element={<ProtectedRoute><Numeros /></ProtectedRoute>} />
            <Route path="/biblioteca" element={<ProtectedRoute><Biblioteca /></ProtectedRoute>} />
            <Route path="/plataforma" element={<ProtectedRoute><Plataforma /></ProtectedRoute>} />
            <Route path="/registros" element={<ProtectedRoute><Registros /></ProtectedRoute>} />
            <Route path="/diagnostico" element={<ProtectedRoute><ModuleGate m="diagnostico"><Diagnostico /></ModuleGate></ProtectedRoute>} />
            <Route path="/cobrancas" element={<ProtectedRoute><ModuleGate m="cobrancas"><Cobrancas /></ModuleGate></ProtectedRoute>} />
            <Route path="/integracoes" element={<ProtectedRoute><Integracoes /></ProtectedRoute>} />
            <Route path="/supervisor" element={<ProtectedRoute><ModuleGate m="gestao"><Supervisor /></ModuleGate></ProtectedRoute>} />
            <Route path="/avaliacoes" element={<ProtectedRoute><ModuleGate m="gestao"><Avaliacoes /></ModuleGate></ProtectedRoute>} />
            <Route path="/campanhas" element={<ProtectedRoute><ModuleGate m="campanhas"><Campanhas /></ModuleGate></ProtectedRoute>} />
            <Route path="/seguranca" element={<ProtectedRoute><Seguranca /></ProtectedRoute>} />
            <Route path="/melhorias" element={<ProtectedRoute><ModuleGate m="gestao"><Melhorias /></ModuleGate></ProtectedRoute>} />
            <Route path="/conhecimento" element={<ProtectedRoute><ModuleGate m="ia"><Conhecimento /></ModuleGate></ProtectedRoute>} />
            <Route path="/clientes" element={<ProtectedRoute><Clientes /></ProtectedRoute>} />
            <Route path="/fluxos" element={<ProtectedRoute><ModuleGate m="ia"><Fluxos /></ModuleGate></ProtectedRoute>} />
            <Route path="/fluxos/:id" element={<ProtectedRoute><ModuleGate m="ia"><FlowEditor /></ModuleGate></ProtectedRoute>} />
            <Route path="/convite" element={<ProtectedRoute allowWithoutOrg><Convite /></ProtectedRoute>} />
            <Route path="/admin/uazapi" element={<ProtectedRoute><AdminRoute><UazapiConfig /></AdminRoute></ProtectedRoute>} />
            <Route path="/conversas" element={<Navigate to="/" replace />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/agente" element={<ProtectedRoute><ModuleGate m="ia"><Agente /></ModuleGate></ProtectedRoute>} />
            <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
            <Route path="/funil" element={<ProtectedRoute><Funil /></ProtectedRoute>} />
            <Route path="/etiquetas" element={<ProtectedRoute><EtiquetasGrupos /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/inicio" element={<ProtectedRoute><Inicio /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><Configuracoes /></ProtectedRoute>} />
            <Route path="/configuracoes/atendimento" element={<ProtectedRoute><ConfigAtendimento /></ProtectedRoute>} />
            <Route path="/configuracoes/aparencia" element={<ProtectedRoute><ConfigAparencia /></ProtectedRoute>} />
            <Route path="/configuracoes/plano" element={<ProtectedRoute><ConfigPlano /></ProtectedRoute>} />
            <Route path="/configuracoes/areas" element={<ProtectedRoute><ModuleGate m="gestao"><ConfigAreas /></ModuleGate></ProtectedRoute>} />
            <Route path="/cerebro" element={<ProtectedRoute><ModuleGate m="gestao"><Cerebro /></ModuleGate></ProtectedRoute>} />
            <Route path="/configuracoes/ia" element={<ProtectedRoute><ModuleGate m="ia"><ConfigIA /></ModuleGate></ProtectedRoute>} />
            <Route path="/configuracoes/cobrancas" element={<ProtectedRoute><ModuleGate m="cobrancas"><ConfigCobrancas /></ModuleGate></ProtectedRoute>} />
            <Route path="/setores" element={<ProtectedRoute><Setores /></ProtectedRoute>} />
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
