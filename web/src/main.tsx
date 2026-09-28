import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { Layout } from './componentes/Layout.tsx';
import { RutaProtegida } from './componentes/RutaProtegida.tsx';
import { DetalleAnalisis } from './paginas/DetalleAnalisis.tsx';
import { Inicio } from './paginas/Inicio.tsx';
import { Login } from './paginas/Login.tsx';
import { NuevoAnalisis } from './paginas/NuevoAnalisis.tsx';
import { Panel } from './paginas/Panel.tsx';
import { ResultadoLote } from './paginas/ResultadoLote.tsx';
import { Verificar } from './paginas/Verificar.tsx';
import { ProveedorSesion } from './sesion.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Inicio />} />
            <Route path="verificar" element={<Verificar />} />
            <Route path="verificar/:loteId" element={<ResultadoLote />} />
            <Route path="laboratorio/login" element={<Login />} />
            <Route path="laboratorio" element={<RutaProtegida />}>
              <Route index element={<Panel />} />
              <Route path="nuevo" element={<NuevoAnalisis />} />
              <Route path="analisis/:analisisId" element={<DetalleAnalisis />} />
            </Route>
            <Route
              path="*"
              element={<p className="py-16 text-center text-stone-500">Página no encontrada.</p>}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  </StrictMode>,
);
