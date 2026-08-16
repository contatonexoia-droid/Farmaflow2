import React, { useState, useMemo } from 'react';
import { PharmacyConfig, DepartmentConfig, Product } from '../types';
import { getDepartmentForCategory, FALLBACK_DEPARTMENT, DEPARTMENT_MAPPING } from '../lib/departments';
import { SmartNumberInput } from './SmartNumberInput';
import { Search, Plus, Save, Package, Pill, Baby, SprayCan, Heart, Sun, Droplets, Stethoscope, BriefcaseMedical, Thermometer, User, Trash2, Edit2, ArchiveRestore, ChevronRight, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Props {
  tenant: PharmacyConfig;
  onTenantUpdate: (data: Partial<PharmacyConfig>) => void;
  products: Product[];
  onProductsUpdate: (updates: Product[]) => void;
}

const AVAILABLE_ICONS = [
  { name: 'Package', icon: Package },
  { name: 'Pills', icon: Pill },
  { name: 'Baby', icon: Baby },
  { name: 'SprayCan', icon: SprayCan },
  { name: 'Heart', icon: Heart },
  { name: 'Sun', icon: Sun },
  { name: 'Droplets', icon: Droplets },
  { name: 'Stethoscope', icon: Stethoscope },
  { name: 'BriefcaseMedical', icon: BriefcaseMedical },
  { name: 'Thermometer', icon: Thermometer },
  { name: 'User', icon: User },
];

export const AdminDepartmentManager: React.FC<Props> = ({ tenant, onTenantUpdate, products, onProductsUpdate }) => {
  const [departments, setDepartments] = useState<DepartmentConfig[]>(() => {
      if (tenant.departments && tenant.departments.length > 0) return tenant.departments;
      
      // Default initialization based on hardcoded rules if none exist
      return Object.entries(DEPARTMENT_MAPPING).map(([name, keywords], idx) => ({
          id: `default_${idx}`,
          name,
          iconName: 'Package', // fallback
          priority: idx,
          categories: keywords
      }));
  });
  
  const [editingDept, setEditingDept] = useState<DepartmentConfig | null>(null);
  
  // Bulk mapping state
  const [selectedSubcats, setSelectedSubcats] = useState<string[]>([]);
  const [mappingTargetDeptId, setMappingTargetDeptId] = useState<string>('');

  const allCategories = useMemo(() => {
     const cats = new Set<string>();
     products.forEach(p => { if (p.category) cats.add(p.category); });
     departments.forEach(d => {
         d.categories.forEach(c => cats.add(c));
     });
     return Array.from(cats).sort();
  }, [products, departments]);

  const saveToDB = async (newDepts: DepartmentConfig[]) => {
      try {
          setDepartments(newDepts);
          await onTenantUpdate({ departments: newDepts });
          toast.success("Departamentos atualizados com sucesso!");
      } catch (error: any) {
          toast.error("Erro ao salvar departamento: " + (error.message || "Tente novamente."));
      }
  };

  const [newSubcatName, setNewSubcatName] = useState('');

  const handleSaveDepartment = async () => {
    if (!editingDept || !editingDept.name) {
       toast.error("Nome do departamento é obrigatório");
       return;
    }
    
    let newDepts = [...departments];
    const existingIdx = newDepts.findIndex(d => d.id === editingDept.id);
    if (existingIdx >= 0) {
        newDepts[existingIdx] = editingDept;
    } else {
        newDepts.push({
            ...editingDept,
            id: Math.random().toString(36).substring(7),
            priority: newDepts.length
        });
    }
    setEditingDept(null);
    setNewSubcatName('');
    await saveToDB(newDepts);
  };

  const handleEdit = (dept: DepartmentConfig) => {
      setEditingDept(dept);
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const [deptToDelete, setDeptToDelete] = useState<DepartmentConfig | null>(null);
  const [targetDeptForMigration, setTargetDeptForMigration] = useState<string>('');

  const confirmDeleteDept = () => {
      if (!deptToDelete) return;

      let newDepts = [...departments];

      // If migrating, move categories to target dept
      if (targetDeptForMigration) {
          const targetDeptIndex = newDepts.findIndex(d => d.id === targetDeptForMigration);
          if (targetDeptIndex >= 0) {
              const mergedCategories = Array.from(new Set([...newDepts[targetDeptIndex].categories, ...deptToDelete.categories]));
              newDepts[targetDeptIndex] = { ...newDepts[targetDeptIndex], categories: mergedCategories };
          }
      }

      newDepts = newDepts.filter(d => d.id !== deptToDelete.id);
      saveToDB(newDepts);
      setDeptToDelete(null);
      setTargetDeptForMigration('');
  };

  const handleDelete = (id: string) => {
      const dept = departments.find(d => d.id === id);
      if (!dept) return;

      const hasActiveProducts = products.some(p => dept.categories.includes(p.category || ''));
      
      if (dept.categories.length > 0 || hasActiveProducts) {
          setDeptToDelete(dept);
          return;
      }

      if (window.confirm(`Tem certeza que deseja excluir o departamento "${dept.name}"?`)) {
          const newDepts = departments.filter(d => d.id !== id);
          saveToDB(newDepts);
      }
  };

  const handleDeleteSubcat = (e: React.MouseEvent, catName: string) => {
      e.stopPropagation(); // prevent toggling the subcat mapping selection

      const linkedProducts = products.filter(p => p.category === catName);
      if (linkedProducts.length > 0) {
          alert(`Não é possível excluir. Existem ${linkedProducts.length} produtos nesta subcategoria. Mova-os primeiro.`);
          return;
      }

      if (window.confirm(`Tem certeza que deseja excluir a subcategoria "${catName}"?`)) {
          // Remove from any department that has it
          const newDepts = departments.map(d => ({
              ...d,
              categories: d.categories.filter(c => c !== catName)
          }));
          saveToDB(newDepts);
          toast.success("Subcategoria excluída.");
          // Note: if there are no products, and it's removed from departments, it will disappear from allCategories hook implicitly
      }
  };

  const handleBulkMap = () => {
      if (selectedSubcats.length === 0 || !mappingTargetDeptId) {
          toast.error("Selecione subcategorias e um departamento de destino.");
          return;
      }
      
      let newDepts = departments.map(d => {
          // Remove selected from any other department
          let newCats = d.categories.filter(c => !selectedSubcats.includes(c));
          
          if (d.id === mappingTargetDeptId) {
              // Add to target
              newCats = Array.from(new Set([...newCats, ...selectedSubcats]));
          }
          
          return { ...d, categories: newCats };
      });
      
      saveToDB(newDepts);
      setSelectedSubcats([]);
      setMappingTargetDeptId('');
  };

  const toggleSubcat = (cat: string) => {
      setSelectedSubcats(prev => 
          prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
      );
  };
  
  return (
      <div className="space-y-6">
          <div className="flex justify-between flex-wrap gap-4 items-center">
             <div>
                 <h2 className="text-2xl font-black">Departamentos e Categorias</h2>
                 <p className="text-gray-500 text-sm">Organize suas categorias em departamentos para facilitar a nevegação.</p>
             </div>
             <button onClick={() => setEditingDept({ id: '', name: '', iconName: 'Package', priority: 0, categories: [] })} className="bg-brand text-brand-contrast px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:opacity-90">
                <Plus size={20} />
                Novo Departamento
             </button>
          </div>

          {editingDept && (
              <div className="p-6 bg-white border rounded-2xl shadow-sm space-y-4">
                  <h3 className="font-bold text-lg">{editingDept.id ? 'Editar Departamento' : 'Novo Departamento'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Nome</label>
                          <input type="text" className="w-full bg-gray-50 p-4 rounded-xl border font-bold" value={editingDept.name} onChange={e => setEditingDept({...editingDept, name: e.target.value})} placeholder="Ex: Higiene e Saúde" />
                      </div>
                      <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Prioridade (Ordem)</label>
                          <SmartNumberInput className="w-full bg-gray-50 p-4 rounded-xl border font-bold" value={editingDept.priority} onChangeValue={val => setEditingDept({...editingDept, priority: val || 0})} />
                      </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                      <div className="col-span-1">
                           <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-2">Nova Subcategoria</label>
                           <div className="flex gap-2">
                               <input type="text" className="flex-1 bg-gray-50 p-4 rounded-xl border font-bold" value={newSubcatName} onChange={e => setNewSubcatName(e.target.value)} placeholder="Nome da subcategoria (ex: Vitaminas e Minerais)" />
                               <button type="button" onClick={() => {
                                   if (!newSubcatName.trim()) return;
                                   if (editingDept.categories.includes(newSubcatName.trim())) {
                                       toast.error("Esta subcategoria já existe neste departamento.");
                                       return;
                                   }
                                   let cats = [...editingDept.categories];
                                   cats.push(newSubcatName.trim());
                                   setEditingDept({...editingDept, categories: cats});
                                   setNewSubcatName('');
                               }} className="bg-gray-200 px-6 rounded-xl font-bold hover:bg-gray-300">Adicionar</button>
                           </div>
                           {editingDept.categories.length > 0 && (
                               <div className="flex flex-wrap gap-2 mt-4 max-h-[150px] overflow-y-auto p-2 bg-gray-50 rounded-xl border">
                                    {editingDept.categories.map((cat, i) => (
                                        <div key={i} className="bg-white border rounded-lg px-3 py-1 flex items-center gap-2 shadow-sm">
                                            <span className="text-sm font-bold text-gray-700">{cat}</span>
                                            <button type="button" onClick={() => {
                                                setEditingDept({
                                                    ...editingDept,
                                                    categories: editingDept.categories.filter((_, idx) => idx !== i)
                                                });
                                            }} className="text-red-500 hover:bg-red-50 rounded p-0.5"><X size={14} /></button>
                                        </div>
                                    ))}
                               </div>
                           )}
                      </div>
                  </div>
                  <div className="flex gap-2 pt-4">
                      <button onClick={handleSaveDepartment} className="bg-emerald-500 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2"><Save size={18} /> Salvar</button>
                      <button onClick={() => { setEditingDept(null); setNewSubcatName(''); }} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-xl font-bold">Cancelar</button>
                  </div>
              </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                  <h3 className="font-bold text-gray-900 border-b pb-2">Departamentos Ativos</h3>
                  {departments.sort((a,b) => a.priority - b.priority).map((dept) => (
                      <div key={dept.id} className="p-5 bg-white border border-gray-100 rounded-2xl flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shadow-sm">
                          <div>
                              <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-500">
                                      <Package size={20} />
                                  </div>
                                  <div>
                                      <h4 className="font-black text-gray-900 text-lg">{dept.name}</h4>
                                      <p className="text-gray-400 text-xs font-bold leading-tight mt-0.5">{dept.categories.length} subcategorias mapeadas</p>
                                  </div>
                              </div>
                          </div>
                          <div className="flex gap-2">
                              <button onClick={() => handleEdit(dept)} className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100"><Edit2 size={18} /></button>
                              <button onClick={() => handleDelete(dept.id)} className="p-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100"><Trash2 size={18} /></button>
                          </div>
                      </div>
                  ))}
              </div>

              <div className="bg-white border rounded-2xl p-5 shadow-sm h-fit">
                  <h3 className="font-black text-lg mb-4 text-gray-900 flex items-center gap-2">
                      <ArchiveRestore className="text-brand" size={20} /> Mapeamento em Massa
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">Selecione subcategorias soltas e mova para um departamento pai.</p>
                  
                  <div className="space-y-2 max-h-[300px] overflow-y-auto mb-4 border rounded-xl p-2 bg-gray-50">
                      {allCategories.map(cat => {
                          const isSelected = selectedSubcats.includes(cat);
                          const currentDept = getDepartmentForCategory(cat, departments);
                          return (
                              <button key={cat} onClick={() => toggleSubcat(cat)} className={`w-full text-left p-3 rounded-lg flex items-center justify-between text-sm transition-all border ${isSelected ? 'border-brand bg-white' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}>
                                  <div>
                                      <span className="font-bold block">{cat}</span>
                                      <span className="text-[10px] uppercase text-gray-400">Em: {currentDept}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                      {isSelected && <div className="w-4 h-4 rounded-full bg-brand"></div>}
                                      <div onClick={(e) => handleDeleteSubcat(e, cat)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors ml-2" title="Excluir Subcategoria">
                                          <Trash2 size={16} />
                                      </div>
                                  </div>
                              </button>
                          );
                      })}
                  </div>

                  <div className="space-y-3">
                      <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-2">Mover para:</label>
                          <select value={mappingTargetDeptId} onChange={e => setMappingTargetDeptId(e.target.value)} className="w-full p-4 rounded-xl font-bold bg-gray-50 border outline-none">
                              <option value="" disabled>Selecionar Departamento...</option>
                              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                      </div>
                      <button onClick={handleBulkMap} className="w-full bg-emerald-500 text-white font-bold p-4 rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-600" disabled={selectedSubcats.length === 0 || !mappingTargetDeptId}>
                          Salvar Mapeamento <ChevronRight size={18} />
                      </button>
                  </div>
              </div>
          </div>

          {deptToDelete && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-6">
                      <div className="flex justify-between items-center">
                          <h3 className="text-xl font-black text-gray-900 border-b pb-2">Excluir Departamento</h3>
                          <button onClick={() => setDeptToDelete(null)} className="p-2 bg-gray-100 rounded-xl text-gray-500 hover:bg-gray-200">
                              <X size={20} />
                          </button>
                      </div>
                      
                      <div className="text-gray-600 space-y-4">
                          <p>O departamento <strong>{deptToDelete.name}</strong> possui <strong>{deptToDelete.categories.length}</strong> subcategorias mapeadas e/ou produtos vinculados.</p>
                          <p className="text-sm font-bold text-red-600">Exclua ou mova as subcategorias deste departamento antes de removê-lo.</p>
                          
                          <div className="pt-4 border-t border-gray-100">
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Deseja mover todos os produtos/subcategorias para outro departamento?</label>
                              <select 
                                  value={targetDeptForMigration} 
                                  onChange={e => setTargetDeptForMigration(e.target.value)} 
                                  className="w-full bg-gray-50 border p-4 rounded-xl font-bold"
                              >
                                  <option value="">Apenas excluir (Voltarão para o departamento "Outros")</option>
                                  {departments.filter(d => d.id !== deptToDelete.id).map(d => (
                                      <option key={d.id} value={d.id}>{d.name}</option>
                                  ))}
                              </select>
                          </div>
                      </div>

                      <div className="flex gap-3">
                          <button onClick={() => setDeptToDelete(null)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200">
                              Cancelar
                          </button>
                          <button onClick={confirmDeleteDept} className="flex-1 bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 flex items-center justify-center gap-2">
                              <Trash2 size={18} /> Confirmar Exclusão
                          </button>
                      </div>
                  </div>
              </div>
          )}
      </div>
  );
};
