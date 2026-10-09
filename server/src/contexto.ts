import type { Db } from './db/index.ts';
import type { ServicioAnclaje } from './anclaje/ServicioAnclaje.ts';
import type { ProcesadorAnclajes } from './anclaje/procesador.ts';
import type { Mercado } from './mercado/mercado.ts';

export interface Contexto {
  db: Db;
  anclaje: ServicioAnclaje;
  procesador: ProcesadorAnclajes;
  /** Marketplace sobre el contrato; solo existe con ANCLAJE=stellar. */
  mercado?: Mercado | null;
}

export interface Usuario {
  id: number;
  email: string;
  nombre: string;
  rol: 'analista' | 'supervisor';
  laboratorio_id: string;
}

export class ErrorHttp extends Error {
  estado: number;
  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.estado = estado;
  }
}
