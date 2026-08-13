async function testarFaker() {
    // Importação dinâmica para contornar o ES Module no CommonJS
    const { fakerPT_BR: faker } = await import('@faker-js/faker');
  
    const restaurante = {
      nome: `${faker.company.name()} ${faker.helpers.arrayElement(['Bistrô', 'Restaurante', 'Grill', 'Burger', 'Cuisine'])}`,
      categoria: faker.helpers.arrayElement(['Italiana', 'Japonesa', 'Brasileira', 'Fast Food', 'Mexicana', 'Vegetariana']),
      endereco: {
        rua: faker.location.street(),
        numero: faker.location.buildingNumber(),
        bairro: faker.location.county(),
        cidade: faker.location.city(),
        estado: faker.location.state({ abbreviated: true })
      },
      telefone: faker.phone.number(),
      avaliacao: faker.number.float({ min: 3.5, max: 5.0, fractionDigits: 1 }),
      horarioFuncionamento: "18:00 - 23:30"
    };
  
    console.log("--- Restaurante Gerado ---");
    console.log(restaurante);
  }
  
  testarFaker();