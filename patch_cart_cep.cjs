const fs = require('fs');
let code = fs.readFileSync('components/Cart.tsx', 'utf8');

// Add state
code = code.replace(
  'const [cepError, setCepError] = useState("");',
  'const [cepError, setCepError] = useState("");\n  const [cepUnknown, setCepUnknown] = useState(false);'
);

const cepBlockOld = `<div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">
                  CEP
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="00000-000"
                    className="flex-1 bg-white border-2 border-gray-50 rounded-2xl py-4 px-6 focus:border-emerald-500 outline-none text-black font-bold placeholder:text-gray-300"
                    value={getDisplayValue("cep")}
                    onFocus={() => {
                      if (
                        realCustomerData &&
                        realCustomerData.cep &&
                        !editedFields.cep
                      ) {
                        handleFieldChange("cep", "");
                      }
                    }}
                    onChange={(e) => {
                      handleFieldChange("cep", e.target.value);
                      setCepError("");
                    }}
                    onKeyDown={handleCepKeyDown}
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    onClick={handleFetchCep}
                    disabled={isFetchingCep}
                    className="bg-emerald-50 text-emerald-600 px-6 py-4 rounded-2xl font-black text-xs uppercase border border-emerald-100 shrink-0"
                  >
                    {isFetchingCep ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <SearchIcon size={16} />
                    )}
                  </button>
                </div>
                {cepError && (
                  <p className="text-xs text-red-500 font-bold px-1 mt-1">
                    {cepError}
                  </p>
                )}
              </div>`;

const cepBlockNew = `<div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">
                    CEP
                  </label>
                  <button 
                    type="button" 
                    onClick={() => {
                      setCepUnknown(!cepUnknown);
                      if (!cepUnknown) {
                         handleFieldChange("cep", "");
                         setCepError("");
                         setTimeout(() => inputRefs.current["address"]?.focus(), 100);
                      }
                    }}
                    className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 underline underline-offset-2"
                  >
                    {cepUnknown ? "Buscar pelo CEP" : "Não sei meu CEP"}
                  </button>
                </div>
                {!cepUnknown && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="00000-000"
                        className="flex-1 bg-white border-2 border-gray-50 rounded-2xl py-4 px-6 focus:border-emerald-500 outline-none text-black font-bold placeholder:text-gray-300"
                        value={getDisplayValue("cep")}
                        onFocus={() => {
                          if (
                            realCustomerData &&
                            realCustomerData.cep &&
                            !editedFields.cep
                          ) {
                            handleFieldChange("cep", "");
                          }
                        }}
                        onChange={(e) => {
                          handleFieldChange("cep", e.target.value);
                          setCepError("");
                        }}
                        onKeyDown={handleCepKeyDown}
                        enterKeyHint="search"
                      />
                      <button
                        type="button"
                        onClick={handleFetchCep}
                        disabled={isFetchingCep}
                        className="bg-emerald-50 text-emerald-600 px-6 py-4 rounded-2xl font-black text-xs uppercase border border-emerald-100 shrink-0"
                      >
                        {isFetchingCep ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <SearchIcon size={16} />
                        )}
                      </button>
                    </div>
                    {cepError && (
                      <p className="text-xs text-red-500 font-bold px-1 mt-1">
                        {cepError}
                      </p>
                    )}
                  </div>
                )}
              </div>`;
code = code.replace(cepBlockOld, cepBlockNew);

fs.writeFileSync('components/Cart.tsx', code);
