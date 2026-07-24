with open("components/Storefront.tsx", "r") as f:
    content = f.read()

target = """  ChevronDown,
} from "lucide-react";"""

replacement = """  ChevronDown,
  Info,
} from "lucide-react";"""

if target in content:
    with open("components/Storefront.tsx", "w") as f:
        f.write(content.replace(target, replacement))
    print("Replaced successfully")
else:
    print("Target not found")
