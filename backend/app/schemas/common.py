from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, PlainSerializer

CENT = Decimal("0.01")


def _money_str(value: Decimal) -> str:
    return format(value.quantize(CENT), "f")


# Monetary values are Decimals end to end and serialized as strings with two decimals
# ("1234.50"), so no precision is lost to JSON floats.
DecimalStr = Annotated[Decimal, PlainSerializer(_money_str, return_type=str)]


class Money(BaseModel):
    amount: DecimalStr
    currency: str
