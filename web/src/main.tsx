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
import { RecuperarAcceso } from './paginas/RecuperarAcceso.tsx';
import { MiCuenta } from './paginas/MiCuenta.tsx';
import { Usuarios } from './paginas/Usuarios.tsx';
import { Mercado } from './paginas/Mercado.tsx';
import { MisLotes } from './paginas/MisLotes.tsx';
import { NuevoAnalisis } from './paginas/NuevoAnalisis.tsx';
import { Panel } from './paginas/Panel.tsx';
import { PerfilVendedor } from './paginas/PerfilVendedor.tsx';
import { ResultadoLote } from './paginas/ResultadoLote.tsx';
import { Verificar } from './paginas/Verificar.tsx';
import { ProveedorSesion } from './sesion.tsx';
import { ProveedorWallet } from './wallet.tsx';
import { ProveedorComercio } from './comercio.tsx';
import { Comercio } from './paginas/Comercio.tsx';
import { Publicar } from './paginas/Publicar.tsx';
import { DetalleAnuncio } from './paginas/DetalleAnuncio.tsx';
import { Operaciones } from './paginas/Operaciones.tsx';
import { DetalleOperacion } from './paginas/DetalleOperacion.tsx';
import { PerfilComercial } from './paginas/PerfilComercial.tsx';
import { LaboratorioComercial } from './paginas/LaboratorioComercial.tsx';
import { RevisionComercial } from './paginas/RevisionComercial.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <ProveedorWallet>
        <ProveedorComercio>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Inicio />} />
              <Route path="verificar" element={<Verificar />} />
              <Route path="verificar/:loteId" element={<ResultadoLote />} />
              <Route path="mercado" element={<Mercado />} />
              <Route path="mercado/vendedor/:id" element={<PerfilVendedor />} />
              <Route path="mercado/:loteId" element={<DetalleMercado />} />
              <Route path="mis-lotes" element={<MisLotes />} />
              <Route path="comercio" element={<Comercio />} />
              <Route path="comercio/nuevo" element={<Publicar />} />
              <Route path="comercio/perfil" element={<PerfilComercial />} />
              <Route path="comercio/anuncios/:id" element={<DetalleAnuncio />} />
              <Route path="operaciones" element={<Operaciones />} />
              <Route path="operaciones/:id" element={<DetalleOperacion />} />
              <Route path="revision" element={<RevisionComercial />} />
              <Route path="laboratorio/login" element={<Login />} />
              <Route path="laboratorio/recuperar" element={<RecuperarAcceso />} />
              <Route path="laboratorio" element={<RutaProtegida />}>
                <Route index element={<Panel />} />
                <Route path="cuenta" element={<MiCuenta />} />
                <Route path="usuarios" element={<Usuarios />} />
                <Route path="nuevo" element={<NuevoAnalisis />} />
                <Route path="analisis/:analisisId" element={<DetalleAnalisis />} />
                <Route path="contra-analisis" element={<ContraAnalisis />} />
                <Route path="comercio" element={<LaboratorioComercial />} />
              </Route>
              <Route
                path="*"
                element={<p className="py-16 text-center text-stone-500">Página no encontrada.</p>}
              />
            </Route>
          </Routes>
        </BrowserRouter>
        </ProveedorComercio>
      </ProveedorWallet>
    </ProveedorSesion>
  </StrictMode>,
);
