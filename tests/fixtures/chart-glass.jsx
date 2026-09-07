import React from 'react';
import { createRoot } from 'react-dom/client';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from '../../src/components/charts/recharts.jsx';
import './chart-glass.css';
const hourly = Array.from({length: 12}, (_, i) => ({ hora: `${String(6 + i).padStart(2,'0')}:00`, produzido: [4,6,5,8,7,10,9,11,8,10,12,9][i], meta: 10, atingimento: [40,60,50,80,70,100,90,110,80,100,120,90][i] }));
const cells = [{ nome: 'Corte', produzido: 10, meta: 12 }, { nome: 'Bordo', produzido: 9, meta: 12 }, { nome: 'Fura', produzido: 7, meta: 10 }];
const shifts = [{ nome: 'Turno 1', produzido: 12, meta: 12 }, { nome: 'Turno 2', produzido: 9, meta: 12 }];
function Horizontal({ data }) { return <BarChart data={data} layout="vertical"><CartesianGrid horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="nome" width={72}/><Tooltip/><Legend verticalAlign="top"/><Bar dataKey="meta" name="Meta" fill="#94a3b8"/><Bar dataKey="produzido" name="Produzido" fill="#15803d"/></BarChart>; }
function Fixture() { return <main>
  <header><div><span className="eyebrow">AC.PROD2 / GESTÃO INDUSTRIAL</span><h1>Painel de produção</h1><p>Dados ilustrativos · validação isolada · sem conexão ao Supabase</p></div><span className="badge">Prévia de interface</span></header>
  <section className="lot"><div><strong>Lote geral · DEMONSTRAÇÃO</strong><span>367 / 5.000 peças finalizadas · <b>7,34%</b></span></div><div className="track"><div className="ac-lot-progress-fill" style={{width:'7.34%',height:'100%'}}/></div></section>
  <section className="grid">
    <article><h2>Produtividade por hora</h2><p>Peças · atingimento no eixo direito</p><ResponsiveContainer width="100%" height={310} chartTitle="Produtividade por hora"><ComposedChart data={hourly}><CartesianGrid vertical={false}/><XAxis dataKey="hora" tick={{fontSize:11}}/><YAxis yAxisId="volume"/><YAxis yAxisId="percent" orientation="right" unit="%"/><Tooltip formatter={(value,name)=>[`${value}${name==='Atingimento'?'%':' peças'}`,name]}/><Legend verticalAlign="top"/><Bar yAxisId="volume" dataKey="meta" name="Meta" fill="#94a3b8" maxBarSize={14} radius={[4,4,0,0]}/><Bar yAxisId="volume" dataKey="produzido" name="Produzido" fill="#15803d" maxBarSize={14} radius={[4,4,0,0]}/><Line yAxisId="percent" dataKey="atingimento" name="Atingimento" stroke="#0284c7" dot={false}/></ComposedChart></ResponsiveContainer></article>
    <article><h2>Produção por célula</h2><p>Mesmo período · peças</p><ResponsiveContainer width="100%" height={310} chartTitle="Produção por célula">{Horizontal({data:cells})}</ResponsiveContainer></article>
    <article><h2>Produção por turno</h2><p>Mesmo período · peças</p><ResponsiveContainer width="100%" height={310} chartTitle="Produção por turno">{Horizontal({data:shifts})}</ResponsiveContainer></article>
    <article><h2>Evolução da produção</h2><p>Quantidade observada por hora · peças</p><ResponsiveContainer width="100%" height={310} chartTitle="Evolução da produção"><LineChart data={hourly}><CartesianGrid vertical={false}/><XAxis dataKey="hora" tick={{fontSize:11}}/><YAxis domain={[0,'auto']}/><Tooltip/><Legend verticalAlign="top"/><Line type="monotone" dataKey="produzido" name="Produzido" stroke="#15803d" strokeWidth={3} dot={{r:3}} connectNulls={false}/></LineChart></ResponsiveContainer></article>
  </section><footer>Referência visual. Os valores de demonstração não medem capacidade, OEE ou produção real.</footer>
</main>; }
createRoot(document.getElementById('root')).render(<Fixture/>);
