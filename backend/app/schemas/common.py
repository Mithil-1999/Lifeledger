from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, PlainSerializer

# Monetary values are Decimals end to end and serialized as strings ("1234.50"),
# so no precision is lost to JSON floats.
DecimalStr = Annotated[Decimal, PlainSerializer(lambda v: format(v, "f"), return_type=str)]


class Money(BaseModel):
    amount: DecimalStr
    currency: str
