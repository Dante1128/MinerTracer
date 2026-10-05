import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { Layout } from './componentes/Layout.tsx';
import { RutaProtegida } from './componentes/RutaProtegida.tsx';
import { ContraAnalisis } from './paginas/ContraAnalisis.tsx';
import { DetalleAnalisis } from './paginas/DetalleAnalisis.tsx';
import { DetalleMercado } from './paginas/DetalleMercado.tsx';
import { Inicio } from './paginas/Inicio.tsx';
import { Login } from './paginas/Login.tsx';
import { Mercado } from './paginas/Mercado.tsx';
import { MisLotes } from './paginas/MisLotes.tsx';
import { NuevoAnalisis } from './paginas/NuevoAnalisis.tsx';
import { Panel } from './paginas/Panel.tsx';
import { ResultadoLote } from './paginas/ResultadoLote.tsx';
import { Verificar } from './paginas/Verificar.tsx';
import { ProveedorSesion } from './sesion.tsx';
import { ProveedorWallet } from './wallet.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <ProveedorWallet>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Inicio />} />
              <Route path="verificar" element={<Verificar />} />
              <Route path="verificar/:loteId" element={<ResultadoLote />} />
              <Route path="mercado" element={<Mercado />} />
              <Route path="mercado/:loteId" element={<DetalleMercado />} />
              <Route path="mis-lotes" element={<MisLotes />} />
              <Route path="laboratorio/login" element={<Login />} />
              <Route path="laboratorio" element={<RutaProtegida />}>
                <Route index element={<Panel />} />
                <Route path="nuevo" element={<NuevoAnalisis />} />
                <Route path="analisis/:analisisId" element={<DetalleAnalisis />} />
                <Route path="contra-analisis" element={<ContraAnalisis />} />
              </Route>
              <Route
                path="*"
                element={<p className="py-16 text-center text-stone-500">Página no encontrada.</p>}
              />
            </Route>
          </Routes>
        </BrowserRouter>
      </ProveedorWallet>
    </ProveedorSesion>
  </StrictMode>,
);
