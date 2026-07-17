import React, { InputHTMLAttributes, useState, useEffect } from 'react';

interface SmartNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | string | undefined;
  onChangeValue: (value: number) => void;
  isFloat?: boolean;
}

export function SmartNumberInput({ 
  value, 
  onChangeValue, 
  isFloat = false, 
  onFocus, 
  onBlur, 
  className, 
  ...props 
}: SmartNumberInputProps) {
  const [localValue, setLocalValue] = useState<string>(value?.toString() || '0');

  // Sync up when external value changes
  useEffect(() => {
    // Prevent overriding local value while typing unless externally enforced
    if (value !== undefined) {
      const parsedExternal = isFloat ? parseFloat(String(value).replace(',', '.')) : parseInt(String(value).replace(',', '.'), 10);
      const parsedLocal = isFloat ? parseFloat(localValue.replace(',', '.')) : parseInt(localValue.replace(',', '.'), 10);
      
      if (!isNaN(parsedExternal) && parsedExternal !== parsedLocal && localValue !== value.toString()) {
          setLocalValue(value.toString());
      }
    }
  }, [value, isFloat]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const numericForm = Number(localValue.replace(',', '.'));
    if (numericForm === 0 || isNaN(numericForm)) {
      setLocalValue('');
    }
    e.target.select();
    if (onFocus) onFocus(e);
  };

  const parseToNumber = (val: string) => {
    const sanitized = val.replace(',', '.');
    return isFloat ? parseFloat(sanitized) : parseInt(sanitized, 10);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    let finalValue = localValue.trim();
    if (finalValue === '' || isNaN(parseToNumber(finalValue))) {
      finalValue = '0';
      setLocalValue('0');
    }
    
    const parsed = parseToNumber(finalValue);
    onChangeValue(parsed);
    
    if (onBlur) onBlur(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allows numbers, comma, dot, and minus sign
    let rawValue = e.target.value.replace(/[^0-9.,-]/g, '');
    setLocalValue(rawValue);
    
    const parsed = parseToNumber(rawValue);
    if (!isNaN(parsed)) {
      onChangeValue(parsed);
    }
  };

  return (
    <input
      type="text"
      inputMode={isFloat ? "decimal" : "numeric"}
      value={localValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
      {...props}
    />
  );
}
