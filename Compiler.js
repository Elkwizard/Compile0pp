function compile(source) {
	const symbols = ["+", "-", "/", "*", "=", "(", ")", "{", "}", ";", "==", "<=", ">=", "<", ">", "!=", "!"];
	const keywords = ["let", "out", "if", "while", "loop", "function", "in", "return"];
	class Token {
		constructor(text, type) {
			this.text = text;
			this.type = type;
		}
		getHTML() {
			return `<span class="token ${this.type.toLowerCase()}">${this.text}</span>`;
		}
	}
	class Line {
		constructor(text, bracketed = []) {
			this.text = text;
			this.bracketed = bracketed;
		}
		getHTML() {
			return `${this.text.map(tok => tok.getHTML()).join(" ")} ${this.bracketed.length ? "\n" + this.bracketed.map(tok => tok.getHTML()).join(" ") + "\n" : ""}`;
		}
	}
	class Variable {
		constructor(name, register) {
			this.name = name;
			this.register = register;
		}
	}
	class Function0pp {
		constructor(name, args, line) {
			this.name = name;
			this.args = args;
			this.line = line;
		}
	}
	Token.IDENTIFIER = "IDENTIFIER";
	Token.OPERATOR = "OPERATOR";
	Token.KEYWORD = "KEYWORD";
	Token.NUMBER = "NUMBER";
	function preprocess(source) {
		return source
			.replace(/\+\+/g, " += 1")
			.replace(/\-\-/g, " -= 1")
			.replace(/\b(\w*?)\s*(\+|\-|\/|\*)\=/g, "$1 = $1 $2 ");
	}
	function getTokens(source) {
		let toks = source
			.split(/\b/g)
			.map(tok => tok.replace(/\s/g, ""))
			.filter(tok => tok)
			.map(tok => {
				let type = Token.IDENTIFIER;
				if (keywords.includes(tok)) type = Token.KEYWORD;
				if (!isNaN(parseInt(tok))) type = Token.NUMBER;
				return new Token(tok, type);
			});
		let splitTokens = [];
		for (let tok of toks) {
			let text = tok.text;
			let result = [];
			for (let i = 0; i < text.length; i++) {
				let acc = "";
				let word;
				let linx = i;
				while (i < text.length) {
					acc += text[i++];
					if (symbols.includes(acc)) {
						word = acc;
						linx = i - 1;
					}
				}
				i = linx;
				if (word) result.push(new Token(word, Token.OPERATOR));
			}
			if (result.length) splitTokens.push(...result);
			else splitTokens.push(tok);
		}
		let finalTokens = [];
		for (let i = 0; i < splitTokens.length; i++) {
			let tok = splitTokens[i];
			let nextTok = splitTokens[i + 1];

			if (nextTok && nextTok.type === Token.NUMBER && tok.text === "-") {
				finalTokens.push(new Token("-" + nextTok.text, Token.NUMBER));
				i++;
			} else finalTokens.push(tok);
		}

		return finalTokens;
	}
	function getLines(toks) {
		let lines = [];
		let acc = [];
		let depth = 0;
		for (let i = 0; i < toks.length; i++) {
			let tok = toks[i];
			acc.push(tok);
			if (tok.text === ";" && !depth) {
				acc.pop();
				lines.push(acc);
				acc = [];
			}
			if (tok.text === "{") depth++;
			if (tok.text === "}") {
				depth--;
				if (!depth) {
					lines.push(acc);
					acc = [];
				}
			}
		}
		return lines.map(line => {
			let inx = line.indexOf(line.find(tok => tok.text === "{"));
			if (inx > -1) return new Line(line.slice(0, inx), line.slice(inx + 1, line.length - 1));
			else return new Line(line);
		});
	}
	function compileLines(lines, global) {
		let result = [];
		for (let i = 0; i < lines.length; i++)
			result.push(compileLine(lines[i], global));

		//remove empty lines
		return compose(...result); //.replace(/(^\n|\n$)/g, "").replace(/\n+/g, "\n");;
	}


	//operations
	function filter(inst) {
		return inst.filter(ins => ins && ins.match(/\S/g));
	}
	function compose(...inst) {
		return filter(inst).join("\n");
	}
	function sign(a) {
		return `(${a})`;
	}
	function negative(a) {
		return `-${a}`;
	}
	function register(a) {
		return `[${a}]`;
	}
	function addLiteral(a, b) {
		return `${a} ${b}`;
	}
	function subtractLiteral(a, b) {
		return addLiteral(a, `-${b}`);
	}
	function add(a, b) {
		return addLiteral(a, register(b));
	}
	function subtract(a, b) {
		return subtractLiteral(a, register(b));
	}
	function reset(a) {
		return `${a} -[${a}]`;
	}
	function setLiteral(a, b) {
		return compose(reset(a), addLiteral(a, b));
	}
	function set(a, b) {
		return setLiteral(a, register(b));
	}
	function outputLiteral(a) {
		return addLiteral(OUTPUT_REGISTER, a);
	}
	function output(a) {
		return outputLiteral(register(a));
	}
	function jumpLiteral(a) {
		return addLiteral(ZERO, a);
	}
	function jump(a) {
		return jumpLiteral(register(a));
	}
	function jumpExactLiteral(a) {
		return compose(
			setLiteral(JUMP_REGISTER, negative(register(ZERO))),
			subtractLiteral(JUMP_REGISTER, 3),
			addLiteral(JUMP_REGISTER, a),
			jump(JUMP_REGISTER)
		);
	}
	function jumpExact(a) {
		return jumpExactLiteral(register(a));
	}
	function loopPush() {
		return compose(
			addLiteral(LOOP_POINTER_REGISTER, LOOP_FRAME_SIZE), 
			addLiteral(LOOP_LENGTH_POINTER_REGISTER, LOOP_FRAME_SIZE)
		);
	}
	function loopPop() {
		return compose(
			setLiteral(LOOP_REGISTER, 0), 
			subtractLiteral(LOOP_POINTER_REGISTER, LOOP_FRAME_SIZE), 
			subtractLiteral(LOOP_LENGTH_POINTER_REGISTER, LOOP_FRAME_SIZE)
		);
	}
	function functionPush(name, args) {
		let fn = functions[name];
		args = args.slice(0, fn.args.length);
		while (args.length < fn.args.length) args.push([new Token("0", Token.NUMBER)]);
		
		let argInst = compose(...args.map(arg => compose(
			addLiteral(CALL_STACK_ARG_POINTER_REGISTER, 1),
			expression(arg),
			set(CALL_STACK_ARG_REGISTER, EXPR_REGISTER)
		)));
		
		return compose(
			//shift
			add(CALL_STACK_POINTER_REGISTER, CALL_STACK_LENGTH_REGISTER),
			add(CALL_STACK_LAST_LENGTH_POINTER_REGISTER, CALL_STACK_LENGTH_REGISTER),
			set(CALL_STACK_LAST_LENGTH_REGISTER, CALL_STACK_LENGTH_REGISTER),
			add(CALL_STACK_LENGTH_POINTER_REGISTER, CALL_STACK_LENGTH_REGISTER),
			set(CALL_STACK_ARG_POINTER_REGISTER, CALL_STACK_LAST_LENGTH_POINTER_REGISTER),
			//args
			argInst,
			set(CALL_STACK_ARG_POINTER_ACCESS_REGISTER, CALL_STACK_LAST_LENGTH_POINTER_REGISTER),
			setLiteral(CALL_STACK_LENGTH_REGISTER, args.length + 3),
			set(CALL_STACK_REGISTER, ZERO),
			addLiteral(CALL_STACK_REGISTER, 6),
			jumpExactLiteral(fn.line)
		);
	}
	function functionPop() {
		return compose(
			set(CALL_STACK_TEMP_REGISTER, CALL_STACK_REGISTER),
			subtract(CALL_STACK_POINTER_REGISTER, CALL_STACK_LAST_LENGTH_REGISTER),
			subtract(CALL_STACK_LENGTH_POINTER_REGISTER, CALL_STACK_LAST_LENGTH_REGISTER),
			subtract(CALL_STACK_LAST_LENGTH_POINTER_REGISTER, CALL_STACK_LAST_LENGTH_REGISTER),
			set(CALL_STACK_ARG_POINTER_ACCESS_REGISTER, CALL_STACK_LAST_LENGTH_POINTER_REGISTER),
			jumpExact(CALL_STACK_TEMP_REGISTER)
		);
	}
	function functionCall(toks) {
		let name = toks[0].text;
		let region = getRegion(toks, "(", ")");
		let args = [];
		for (let i = 0; i < region.length; i += 2) args.push([region[i]]);
		return functionPush(name, args);
	}

	//token processes
	function simpleExpression(tok, REGISTER) {
		if (tok.type === Token.NUMBER) {
			//number
			return setLiteral(REGISTER, tok.text);
		} else if (tok.type === Token.KEYWORD) {
			//in
			return set(REGISTER, INPUT_REGISTER);
		} else {
			//variable
			return compose(variable(tok), set(REGISTER, register(VARIABLE_POINTER_REGISTER)));
		}
	}
	function differenceOffset() {
		return compose(
			set(OFFSET_REGISTER, OPERAND_REGISTER_A),
			subtract(OFFSET_REGISTER, OPERAND_REGISTER_B),
			setLiteral(OFFSET_REGISTER_TEMP, sign(OFFSET_REGISTER)),
			addLiteral(OFFSET_REGISTER_TEMP, 1),
			set(OFFSET_REGISTER, OFFSET_REGISTER_TEMP)
		);
	}
	function comparison(o1, o2, o3) {
		return compose(
			reset(EXPR_REGISTER),
			differenceOffset(),
			add(OFFSET_REGISTER, OFFSET_REGISTER),
			jump(OFFSET_REGISTER),
			addLiteral(EXPR_REGISTER, o1),
			jumpLiteral(3),
			addLiteral(EXPR_REGISTER, o2),
			jumpLiteral(1),
			addLiteral(EXPR_REGISTER, o3),
		);
	}
	function expression(toks) {
		if (getIndex(toks, "(") > -1) {
			// function call
			return functionCall(toks);
		} else if (toks.length === 1) {
			// number or variable
			let tok = toks[0];
			return simpleExpression(tok, EXPR_REGISTER);
		} else if (toks.length === 2) {
			// unary operator
			let op = toks[0].text;
			let a = simpleExpression(toks[1], OPERAND_REGISTER_A);
			switch (op) {
				case "-":
					return compose(
						a,
						reset(EXPR_REGISTER),
						subtract(EXPR_REGISTER, OPERAND_REGISTER_A)
					);
				case "!":
					return compose(
						a,
						reset(EXPR_REGISTER),
						setLiteral(UNARY_INVERSION_REGISTER, sign(OPERAND_REGISTER_A)),
						addLiteral(UNARY_INVERSION_REGISTER, 1),
						jump(UNARY_INVERSION_REGISTER),
						jumpLiteral(1),
						addLiteral(EXPR_REGISTER, 1)
					);
			}
		} else if (toks.length === 3) {
			// binary operator
			let op = toks[1].text;
			let a = simpleExpression(toks[0], OPERAND_REGISTER_A);
			let b = simpleExpression(toks[2], OPERAND_REGISTER_B);
			let prefix = compose(a, b);
			switch (op) {
				case "+":
					return compose(
						prefix,
						set(EXPR_REGISTER, OPERAND_REGISTER_A),
						add(EXPR_REGISTER, OPERAND_REGISTER_B)
					);
				case "-":
					return compose(
						prefix,
						set(EXPR_REGISTER, OPERAND_REGISTER_A),
						subtract(EXPR_REGISTER, OPERAND_REGISTER_B)
					);
				case "*":
					return compose(
						prefix,
						set(MULTIPLICATION_PROGRESS_REGISTER, OPERAND_REGISTER_B),
						reset(EXPR_REGISTER),
						setLiteral(MULTIPLICATION_DIRECTION_REGISTER, sign(MULTIPLICATION_PROGRESS_REGISTER)),
						subtractLiteral(MULTIPLICATION_PROGRESS_REGISTER, sign(MULTIPLICATION_PROGRESS_REGISTER)),
						addLiteral(MULTIPLICATION_DIRECTION_REGISTER, 1),
						add(MULTIPLICATION_DIRECTION_REGISTER, MULTIPLICATION_DIRECTION_REGISTER),
						jump(MULTIPLICATION_DIRECTION_REGISTER),
						subtract(EXPR_REGISTER, OPERAND_REGISTER_A),
						jumpLiteral(3),
						jumpLiteral(3),
						jumpLiteral(2),
						add(EXPR_REGISTER, OPERAND_REGISTER_A),
						jumpLiteral(-12)
					);
				case "/":
					let nonZeroDivision = compose(
						reset(DIVISION_SIGN_REGISTER),
						//change A sign
						reset(DIVISION_NEGATION_REGISTER),
						setLiteral(DIVISION_OFFSET_REGISTER_A, negative(sign(OPERAND_REGISTER_A))),
						addLiteral(DIVISION_OFFSET_REGISTER_A, 1),
						jump(DIVISION_OFFSET_REGISTER_A),
						//1
						jumpLiteral(5),
						//0
						jumpLiteral(4),
						//-1
						addLiteral(DIVISION_SIGN_REGISTER, 1),
						subtract(DIVISION_NEGATION_REGISTER, OPERAND_REGISTER_A),
						set(OPERAND_REGISTER_A, DIVISION_NEGATION_REGISTER),
						// // change B sign
						reset(DIVISION_NEGATION_REGISTER),
						setLiteral(DIVISION_OFFSET_REGISTER_A, negative(sign(OPERAND_REGISTER_B))),
						addLiteral(DIVISION_OFFSET_REGISTER_A, 1),
						jump(DIVISION_OFFSET_REGISTER_A),
						//1
						jumpLiteral(10),
						//0
						jumpLiteral(9),
						//-1
						subtract(DIVISION_NEGATION_REGISTER, OPERAND_REGISTER_B),
						set(OPERAND_REGISTER_B, DIVISION_NEGATION_REGISTER),
						jump(DIVISION_SIGN_REGISTER),
						jumpLiteral(1),
						jumpLiteral(2),
						// +a / -b
						addLiteral(DIVISION_SIGN_REGISTER, 1),
						jumpLiteral(1),
						// -a / -b
						reset(DIVISION_SIGN_REGISTER),
						//positive division
						reset(EXPR_REGISTER),
						set(DIVISION_REMAINDER_REGISTER, OPERAND_REGISTER_A),
						// while (a > b) a -= b;
						set(DIVISION_OFFSET_REGISTER_A, DIVISION_REMAINDER_REGISTER),
						subtract(DIVISION_OFFSET_REGISTER_A, OPERAND_REGISTER_B),
						setLiteral(DIVISION_OFFSET_REGISTER_B, sign(DIVISION_OFFSET_REGISTER_A)),
						addLiteral(DIVISION_OFFSET_REGISTER_B, 1),
						jump(DIVISION_OFFSET_REGISTER_B),
						jumpLiteral(/* leave loop */ 4),
						jumpLiteral(0),
						addLiteral(EXPR_REGISTER, 1),
						subtract(DIVISION_REMAINDER_REGISTER, OPERAND_REGISTER_B),
						jumpLiteral(-12),
						//adjust sign
						jump(DIVISION_SIGN_REGISTER),
						jumpLiteral(4),
						reset(DIVISION_NEGATION_REGISTER),
						subtract(DIVISION_NEGATION_REGISTER, EXPR_REGISTER),
						set(EXPR_REGISTER, DIVISION_NEGATION_REGISTER)
					);
					return compose(
						prefix,
						//don't divide by zero, kids!
						setLiteral(DIVISION_OFFSET_REGISTER_A, sign(OPERAND_REGISTER_B)),
						addLiteral(DIVISION_OFFSET_REGISTER_A, 1),
						jump(DIVISION_OFFSET_REGISTER_A),
						jumpLiteral(1),
						jumpLiteral(getLength(nonZeroDivision)),
						nonZeroDivision
					);
				case "==":
					return compose(prefix, comparison(0, 1, 0));
				case "!=":
					return compose(prefix, comparison(1, 0, 1));
				case "<":
					return compose(prefix, comparison(1, 0, 0));
				case "<=":
					return compose(prefix, comparison(1, 1, 0));
				case ">":
					return compose(prefix, comparison(0, 0, 1));
				case ">=":
					return compose(prefix, comparison(0, 1, 1));
			}
		}
	}
	function condition(compiled, REGISTER) {
		return compose(
			setLiteral(CONDITION_OFFSET_REGISTER, sign(REGISTER)),
			addLiteral(CONDITION_OFFSET_REGISTER, 1),
			jump(CONDITION_OFFSET_REGISTER),
			jumpLiteral(1),
			jumpLiteral(getLength(compiled)),
			compiled
		);
	}

	
	function compileTokens(toks) {
		return compileLines(getLines(toks));
	}
	function variable(tok) {
		if (variables[tok.text]) {
			return setLiteral(VARIABLE_POINTER_REGISTER, variables[tok.text].register);
		} else if (tok.paramNumber !== undefined) {
			return compose(
				set(VARIABLE_POINTER_REGISTER, CALL_STACK_ARG_POINTER_ACCESS_REGISTER),
				addLiteral(VARIABLE_POINTER_REGISTER, tok.paramNumber + 1)
			);
		} else throw new Error("Undefined variable [" + tok.text + "]");
	}
	function getIndex(toks, char) {
		return toks.indexOf(toks.find(tok => tok.text === char));
	}
	function getRegion(toks, start, end) {
		let s = getIndex(toks, start);
		let e = getIndex(toks, end);
		return toks.slice(s + 1, e);
	}
	function getLength(text) {
		return filter(text.split("\n")).length;
	}



	let variables = {};
	let functions = {};
	const MEMORY_BLOCK_SIZE = 100;
	const SYSTEM_REGISTER_START = 1;
	const VARIABLE_BLOCK_START = MEMORY_BLOCK_SIZE + SYSTEM_REGISTER_START;
	const LOOP_BLOCK_START = MEMORY_BLOCK_SIZE + VARIABLE_BLOCK_START;
	const LOOP_FRAME_SIZE = 2;
	const FUNCTION_BLOCK_START = MEMORY_BLOCK_SIZE + LOOP_BLOCK_START;

	let currentRegister = VARIABLE_BLOCK_START;
	let systemCurrentRegister = SYSTEM_REGISTER_START;
	function nextSystemRegister() {
		return systemCurrentRegister++;
	}
	let functionStart = "";

	const 	JUMP_REGISTER =								nextSystemRegister(),
			EXPR_REGISTER = 							nextSystemRegister(),
			VARIABLE_POINTER_REGISTER =					nextSystemRegister(),
			MULTIPLICATION_PROGRESS_REGISTER = 			nextSystemRegister(),
			MULTIPLICATION_DIRECTION_REGISTER =			nextSystemRegister(),
			DIVISION_REMAINDER_REGISTER = 				nextSystemRegister(),
			DIVISION_OFFSET_REGISTER_A =				nextSystemRegister(),
			DIVISION_OFFSET_REGISTER_B =				nextSystemRegister(),
			DIVISION_SIGN_REGISTER = 					nextSystemRegister(),
			DIVISION_NEGATION_REGISTER = 				nextSystemRegister(),
			UNARY_INVERSION_REGISTER =					nextSystemRegister(),
			OPERAND_REGISTER_A = 						nextSystemRegister(),
			OPERAND_REGISTER_B = 						nextSystemRegister(),
			OFFSET_REGISTER_TEMP = 						nextSystemRegister(),
			OFFSET_REGISTER = 							nextSystemRegister(),
			LOOP_POINTER_REGISTER = 					nextSystemRegister(),
			LOOP_LENGTH_POINTER_REGISTER = 				nextSystemRegister(),
			LOOP_REGISTER = 							register(LOOP_POINTER_REGISTER),
			LOOP_LENGTH_REGISTER =						register(LOOP_LENGTH_POINTER_REGISTER),
			CALL_STACK_POINTER_REGISTER = 				nextSystemRegister(),
			CALL_STACK_LENGTH_POINTER_REGISTER =		nextSystemRegister(),
			CALL_STACK_LAST_LENGTH_POINTER_REGISTER = 	nextSystemRegister(),
			CALL_STACK_ARG_POINTER_REGISTER =			nextSystemRegister(),
			CALL_STACK_ARG_POINTER_ACCESS_REGISTER =	nextSystemRegister(),
			CALL_STACK_TEMP_REGISTER =					nextSystemRegister(),
			CALL_STACK_ARG_REGISTER =					register(CALL_STACK_ARG_POINTER_REGISTER),
			CALL_STACK_REGISTER =						register(CALL_STACK_POINTER_REGISTER),
			CALL_STACK_LENGTH_REGISTER =				register(CALL_STACK_LENGTH_POINTER_REGISTER),
			CALL_STACK_LAST_LENGTH_REGISTER =			register(CALL_STACK_LAST_LENGTH_POINTER_REGISTER),
			CONDITION_OFFSET_REGISTER = 				nextSystemRegister(),
			ZERO = 										0,
			OUTPUT_REGISTER = 							-1,
			INPUT_REGISTER = 							-2;
	const PROGRAM_INIT = compose(
		setLiteral(LOOP_POINTER_REGISTER, LOOP_BLOCK_START),
		setLiteral(LOOP_LENGTH_POINTER_REGISTER, LOOP_BLOCK_START + 1),
		setLiteral(CALL_STACK_POINTER_REGISTER, FUNCTION_BLOCK_START),
		setLiteral(CALL_STACK_LENGTH_POINTER_REGISTER, FUNCTION_BLOCK_START + 1),
		setLiteral(CALL_STACK_LAST_LENGTH_POINTER_REGISTER, FUNCTION_BLOCK_START + 2),
	);
	function malloc() {
		return currentRegister++;
	}
	function createVariable(n, reg = malloc()) {
		if (variables[n]) throw new Error(`Redeclaration of variable "${n}"`);
		variables[n] = new Variable(n, reg);
	}
	function deleteVariable(n) {
		delete variables[n];
	}
	createVariable("i", LOOP_REGISTER);
	function compileLine(line, global = false) {
		let { text, bracketed } = line;

		let result = "";
		function statement(str) {
			result = compose(result, str);
		}
		if (text[0].type === Token.KEYWORD) {
			let keyword = text[0].text;
			if (keyword === "let") {
				// let a = b
				let varName = text[1].text;
				createVariable(varName);
				statement(expression(text.slice(3)));
				statement(variable(text[1]));
				statement(add(register(VARIABLE_POINTER_REGISTER), EXPR_REGISTER));
			}
			if (keyword === "out") {
				// out a
				statement(expression(text.slice(1)));
				statement(output(EXPR_REGISTER));
			}
			if (keyword === "if") {
				// if (exprA ==,!=,<=,>=,<,> exprB) { exec; }
				let region = getRegion(text, "(", ")");
				statement(expression(region));
				statement(condition(compileTokens(bracketed), EXPR_REGISTER));
			}
			if (keyword === "while") {
				// while (exprA == exprB) { exec; }
				let region = getRegion(text, "(", ")");
				let check = expression(region);
				let body = compileTokens(bracketed);
				let length = getLength(body) + getLength(check) + 1 /* prevent inc */ + 6 /* length of condition */ 
				statement(check);
				statement(condition(compose(
					body,
					jumpLiteral(-length)
				), EXPR_REGISTER));
			}
			if (keyword === "loop") {
				// loop (a) { exec; }
				let region = getRegion(text, "(", ")");
				let count = expression(region);
				let body = compileTokens(bracketed);
				let length = 1 /* prevent inc */ + 2 /* back to body */ + getLength(body) /* get through jumps */ + 4 /* go through difference offset */ + 5 /* through differenceOffset setup */ + 6;  
				let escapeLength = getLength(body) /* through loop end */ + 2;
				statement(loopPush());
				statement(count);
				statement(set(LOOP_LENGTH_REGISTER, EXPR_REGISTER));
				//loop complete start
				statement(set(OPERAND_REGISTER_A, LOOP_REGISTER));
				statement(set(OPERAND_REGISTER_B, LOOP_LENGTH_REGISTER));
				statement(differenceOffset());
				statement(jump(OFFSET_REGISTER));
				statement(/* return to loop start */ jumpLiteral(2));
				statement(/* jump out of loop */ jumpLiteral(escapeLength + 1));
				statement(/* jump out of loop */ jumpLiteral(escapeLength));
				//loop start
				statement(body);
				statement(addLiteral(LOOP_REGISTER, 1));
				statement(jumpLiteral(-length));
				statement(loopPop());
			}
			if (keyword === "return") {
				return compose(
					expression(text.slice(1)),
					functionPop()
				);
			}
			if (keyword === "function") {
				if (!global) throw new Error("Non-global Function");
				let name = getRegion(text, "function", "(")[0].text;
				let region = getRegion(text, "(", ")");
				let args = [];
				for (let i = 0; i < region.length; i += 2) args.push(region[i].text);
			
				for (let i = 0; i < bracketed.length; i++) {
					let tok = bracketed[i];
					if (args.includes(tok.text)) tok.paramNumber = args.indexOf(tok.text);
				}

				functions[name] = new Function0pp(name, args, getLength(functionStart) + getLength(PROGRAM_INIT));
				let body = compileTokens(bracketed);
				body = compose(
					body,
					functionPop()
				);

				functionStart = compose(functionStart, body);
			}
		}
		if (text[0].type === Token.IDENTIFIER) {
			if (text[1].text === "=") {
				// a = b
				statement(expression(text.slice(2)));
				statement(variable(text[0]));
				statement(set(register(VARIABLE_POINTER_REGISTER), EXPR_REGISTER));
			}
			if (text[1].text === "(") {
				//fn ()
				statement(functionCall(text));
			}
		}
		return result;
	}

	let pre = preprocess(source);
	let toks = getTokens(pre);
	let lines = getLines(toks);
	let compiled = compileLines(lines, true);
	
	//function start
	let len = functionStart.length ? getLength(functionStart) : 0;
	functionStart = compose(jumpLiteral(len), functionStart);
	compiled = compose(PROGRAM_INIT, functionStart, compiled);
	
	return compiled;
}